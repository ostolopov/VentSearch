"""
VENTMASH — REST API на FastAPI (OpenAPI: /docs, /redoc).
Фронтенд обслуживается отдельно; CORS настраивается через CORS_ORIGINS.
"""
import logging
import base64

import socket
import ipaddress

import re
import threading
import traceback
from contextlib import asynccontextmanager, contextmanager
from datetime import datetime
from io import BytesIO
from pathlib import Path
from typing import Annotated, Any, Literal, Optional

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
PHOTOS_DIR = Path(__file__).resolve().parent.parent / "photos"

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi import Path as PathParam
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from starlette.exceptions import HTTPException as StarletteHTTPException

from api.schemas import (
    CatalogFacetsOut,
    ErrorOut,
    HealthOut,
    HTTPValidationErrorOut,
    PdfExportRequest,
    ProductListPageOut,
    ProductOut,
    QPPointOut,
)
from config import CORS_ORIGINS, CSV_PATH, PORT
from database import init_database, shutdown_database
from db.connection import get_connection, put_connection
from db.init_db import init_db
from db.csv_sync import sync_catalog_from_csv
from db.repository import (
    count_products,
    count_products_filtered,
    get_by_id,
    get_by_model_or_slug,
    list_distinct_diameters,
    list_distinct_types,
    list_products,
)
from search.catalog_index import CatalogIndex, set_catalog_index

logger = logging.getLogger(__name__)

_catalog_sync_lock = threading.Lock()


def _ensure_catalog_sync_with_reindex() -> None:
    """Проверка CSV (mtime/size, при смене — SHA-256) и пересборка поискового индекса при переимпорте."""
    with _catalog_sync_lock:
        conn = get_connection()
        try:
            if sync_catalog_from_csv(conn, CSV_PATH):
                try:
                    set_catalog_index(CatalogIndex.build(conn))
                except Exception:
                    logger.exception(
                        "Не удалось пересобрать поисковый индекс после обновления CSV, используется только SQL"
                    )
                    set_catalog_index(None)
        finally:
            put_connection(conn)


def normalize_whitespace(value: Any) -> str:
    if value is None:
        return ""
    return " ".join(str(value).replace("\u00A0", " ").split())


def slugify(value: str) -> str:
    s = normalize_whitespace(value).lower()
    s = re.sub(r"[^\w]+", "-", s, flags=re.UNICODE)
    s = re.sub(r"-{2,}", "-", s).strip("-")
    return s


@contextmanager
def db_session():
    conn = get_connection()
    try:
        yield conn
    finally:
        put_connection(conn)


def _startup_db() -> None:
    init_database()
    conn = get_connection()
    try:
        init_db(conn)
        sync_catalog_from_csv(conn, CSV_PATH)
        try:
            set_catalog_index(CatalogIndex.build(conn))
        except Exception:
            logger.exception("Не удалось построить поисковый индекс (Bloom + числовые оси), используется только SQL")
            set_catalog_index(None)
    finally:
        put_connection(conn)


def _safe_pdf_filename(name: Optional[str]) -> str:
    base = normalize_whitespace(name or "ventmash-compare.pdf")
    if not base.lower().endswith(".pdf"):
        base = f"{base}.pdf"
    cleaned = re.sub(r'[^A-Za-z0-9._-]+', "-", base).strip("-")
    return cleaned or "ventmash-compare.pdf"


def _to_float(value: Any) -> Optional[float]:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _extract_chart_png_bytes(chart_image_data_url: Optional[str]) -> Optional[bytes]:
    if not chart_image_data_url:
        return None
    raw = chart_image_data_url.strip()
    if not raw.startswith("data:image/png;base64,"):
        return None
    try:
        return base64.b64decode(raw.split(",", 1)[1], validate=True)
    except Exception:
        return None


def _format_pdf_num(value: Any) -> str:
    num = _to_float(value)
    if num is None:
        return "—"
    if float(num).is_integer():
        return f"{int(num):,}".replace(",", " ")
    return f"{num:,.2f}".replace(",", " ").replace(".", ",")


def _pick_pdf_fonts() -> tuple[str, str]:
    """
    Подбирает шрифт с поддержкой кириллицы.
    Возвращает (regular, bold). Если системные TTF недоступны — fallback на Helvetica.
    """
    candidates = [
        (
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        ),
        (
            "/Library/Fonts/Arial Unicode.ttf",
            "/Library/Fonts/Arial Bold.ttf",
        ),
        (
            "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
            "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        ),
    ]
    for regular_path, bold_path in candidates:
        reg = Path(regular_path)
        bold = Path(bold_path)
        if not reg.exists():
            continue
        regular_name = f"VentPdfRegular-{reg.stem}"
        bold_name = f"VentPdfBold-{bold.stem if bold.exists() else reg.stem}"
        try:
            if regular_name not in pdfmetrics.getRegisteredFontNames():
                pdfmetrics.registerFont(TTFont(regular_name, str(reg)))
            if bold.exists():
                if bold_name not in pdfmetrics.getRegisteredFontNames():
                    pdfmetrics.registerFont(TTFont(bold_name, str(bold)))
            else:
                bold_name = regular_name
            return regular_name, bold_name
        except Exception:
            logger.warning("Не удалось зарегистрировать PDF-шрифт %s", regular_path, exc_info=True)
    return "Helvetica", "Helvetica-Bold"


def _build_compare_pdf(products: list[dict[str, Any]], chart_png: Optional[bytes] = None) -> bytes:
    buf = BytesIO()
    pdf = canvas.Canvas(buf, pagesize=A4)
    page_w, page_h = A4
    left = 14 * mm
    right = page_w - 14 * mm
    width = right - left
    y = page_h - 14 * mm
    font_regular, font_bold = _pick_pdf_fonts()
    c_primary = colors.HexColor("#027bf3")
    c_surface = colors.HexColor("#f6f8fa")
    c_border = colors.HexColor("#e2e5e9")
    c_text = colors.HexColor("#111111")
    c_muted = colors.HexColor("#55595d")
    c_best = colors.HexColor("#e8f7e8")

    def new_page() -> None:
        nonlocal y
        pdf.showPage()
        y = page_h - 14 * mm

    def line(text: str, step: float = 5.6 * mm, bold: bool = False, color: Any = None, size: int = 10) -> None:
        nonlocal y
        if y < 20 * mm:
            new_page()
        pdf.setFillColor(color or c_text)
        pdf.setFont(font_bold if bold else font_regular, size)
        pdf.drawString(left, y, text)
        y -= step

    def card_header(title: str, subtitle: Optional[str] = None) -> None:
        nonlocal y
        h = 18 * mm if subtitle else 13 * mm
        if y - h < 18 * mm:
            new_page()
        pdf.setFillColor(c_primary)
        pdf.roundRect(left, y - h, width, h, 3 * mm, stroke=0, fill=1)
        pdf.setFillColor(colors.white)
        pdf.setFont(font_bold, 13)
        pdf.drawString(left + 4 * mm, y - 6.5 * mm, title)
        if subtitle:
            pdf.setFont(font_regular, 9)
            pdf.drawString(left + 4 * mm, y - 12 * mm, subtitle)
        y -= h + 4 * mm

    def draw_row(label: str, values: list[str], highlights: set[int]) -> None:
        nonlocal y
        row_h = 7.4 * mm
        label_w = 42 * mm
        model_count = max(1, len(values))
        value_w = (width - label_w) / model_count
        if y - row_h < 18 * mm:
            new_page()
        pdf.setStrokeColor(c_border)
        pdf.setFillColor(c_surface)
        pdf.rect(left, y - row_h, label_w, row_h, stroke=1, fill=1)
        pdf.setFillColor(c_text)
        pdf.setFont(font_bold, 8.5)
        pdf.drawString(left + 1.8 * mm, y - 4.9 * mm, label)
        for idx, text in enumerate(values):
            x = left + label_w + idx * value_w
            fill = c_best if idx in highlights else colors.white
            pdf.setFillColor(fill)
            pdf.rect(x, y - row_h, value_w, row_h, stroke=1, fill=1)
            pdf.setFillColor(c_text)
            pdf.setFont(font_regular, 8)
            clipped = normalize_whitespace(text)[:36]
            pdf.drawString(x + 1.2 * mm, y - 4.9 * mm, clipped or "—")
        y -= row_h

    pdf.setAuthor("VENTMASH API")
    pdf.setTitle("VENTMASH Сравнение моделей")
    card_header(
        "VENTMASH — отчет по сравнению",
        f"Дата выгрузки: {datetime.now().strftime('%d.%m.%Y %H:%M')}   |   Выбрано моделей: {len(products)}",
    )

    if chart_png:
        try:
            image = ImageReader(BytesIO(chart_png))
            chart_w = width
            chart_h = 72 * mm
            if y - chart_h < 20 * mm:
                new_page()
            pdf.setStrokeColor(c_border)
            pdf.setFillColor(colors.white)
            pdf.roundRect(left, y - chart_h - 3 * mm, chart_w, chart_h + 3 * mm, 2 * mm, stroke=1, fill=1)
            pdf.drawImage(image, left, y - chart_h, width=chart_w, height=chart_h, preserveAspectRatio=True, mask="auto")
            y -= chart_h + 6 * mm
            line("График Q-P, полученный из интерфейса сравнения.", step=6.5 * mm, color=c_muted, size=9)
        except Exception:
            line("Не удалось встроить график Q-P в отчет.", step=6.5 * mm, color=c_muted, size=9)

    models = [normalize_whitespace(p.get("model") or p.get("id") or "Без названия") for p in products]
    types = [normalize_whitespace(p.get("type") or "—") for p in products]
    sizes = [normalize_whitespace(p.get("size") or "—") for p in products]
    diameters = [f"{_format_pdf_num(p.get('diameter'))} мм" if p.get("diameter") is not None else "—" for p in products]
    airflows = [normalize_whitespace((p.get("airflow") or {}).get("raw") or "—") for p in products]
    pressures = [normalize_whitespace((p.get("pressure") or {}).get("raw") or "—") for p in products]
    powers = [f"{_format_pdf_num(p.get('power'))} Вт" if p.get("power") is not None else "—" for p in products]
    noises = [f"{_format_pdf_num(p.get('noise_level'))} дБ" if p.get("noise_level") is not None else "—" for p in products]
    prices = [f"{_format_pdf_num(p.get('price'))} ₽" if p.get("price") is not None else "по запросу" for p in products]

    power_values = [_to_float(p.get("power")) for p in products]
    noise_values = [_to_float(p.get("noise_level")) for p in products]
    price_values = [_to_float(p.get("price")) for p in products]
    airflow_max_values = [_to_float((p.get("airflow") or {}).get("max")) for p in products]
    pressure_max_values = [_to_float((p.get("pressure") or {}).get("max")) for p in products]

    def min_indexes(arr: list[Optional[float]]) -> set[int]:
        valid = [(i, v) for i, v in enumerate(arr) if v is not None]
        if not valid:
            return set()
        target = min(v for _, v in valid)
        return {i for i, v in valid if v == target}

    def max_indexes(arr: list[Optional[float]]) -> set[int]:
        valid = [(i, v) for i, v in enumerate(arr) if v is not None]
        if not valid:
            return set()
        target = max(v for _, v in valid)
        return {i for i, v in valid if v == target}

    line("Сравнительная таблица (лучшие значения выделены):", step=7.0 * mm, bold=True, size=10)
    draw_row("Модель", models, set())
    draw_row("Тип", types, set())
    draw_row("Типоразмер", sizes, set())
    draw_row("Диаметр", diameters, set())
    draw_row("Расход", airflows, max_indexes(airflow_max_values))
    draw_row("Давление", pressures, max_indexes(pressure_max_values))
    draw_row("Мощность", powers, min_indexes(power_values))
    draw_row("Шум", noises, min_indexes(noise_values))
    draw_row("Цена", prices, min_indexes(price_values))

    y -= 4 * mm
    line("Подробно по моделям:", step=7.0 * mm, bold=True)
    for idx, p in enumerate(products, start=1):
        if y < 36 * mm:
            new_page()
        card_h = 30 * mm
        pdf.setStrokeColor(c_border)
        pdf.setFillColor(colors.white)
        pdf.roundRect(left, y - card_h, width, card_h, 2 * mm, stroke=1, fill=1)
        pdf.setFillColor(c_text)
        pdf.setFont(font_bold, 10)
        title = normalize_whitespace(p.get("model") or p.get("id") or "Без названия")
        pdf.drawString(left + 3 * mm, y - 6 * mm, f"{idx}. {title}"[:95])
        pdf.setFillColor(c_muted)
        pdf.setFont(font_regular, 8.5)
        pdf.drawString(left + 3 * mm, y - 11 * mm, f"ID: {normalize_whitespace(p.get('id') or '—')}")
        pdf.drawString(
            left + 3 * mm,
            y - 15.5 * mm,
            f"Тип: {normalize_whitespace(p.get('type') or '—')}   |   Типоразмер: {normalize_whitespace(p.get('size') or '—')}",
        )
        pdf.drawString(
            left + 3 * mm,
            y - 20 * mm,
            f"Расход: {normalize_whitespace((p.get('airflow') or {}).get('raw') or '—')}   |   Давление: {normalize_whitespace((p.get('pressure') or {}).get('raw') or '—')}",
        )
        pdf.drawString(
            left + 3 * mm,
            y - 24.5 * mm,
            f"Мощность: {powers[idx - 1]}   |   Шум: {noises[idx - 1]}   |   Цена: {prices[idx - 1]}",
        )
        y -= card_h + 3.5 * mm

    pdf.save()
    data = buf.getvalue()
    buf.close()
    return data


@asynccontextmanager
async def lifespan(app: FastAPI):
    _startup_db()
    yield
    set_catalog_index(None)
    shutdown_database()


app = FastAPI(
    title="VENTMASH API",
    description=(
        "B2B-каталог промышленных вентиляторов. "
        "Данные в PostgreSQL; CSV синхронизируется по mtime/размеру и при смене содержимого (SHA-256)."
    ),
    version="0.2.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if PHOTOS_DIR.exists():
    app.mount("/photos", StaticFiles(directory=str(PHOTOS_DIR)), name="photos")


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(status_code=422, content={"detail": exc.errors()})


def _wants_html(request: Request) -> bool:
    accept = (request.headers.get("accept") or "").lower()
    return "text/html" in accept or "*/*" in accept


def _is_frontend_request(request: Request) -> bool:
    path = request.url.path or ""
    return not path.startswith("/api")


def _discover_local_ipv4_candidates() -> list[str]:
    candidates: set[str] = set()
    try:
        # Primary address used for outbound traffic.
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            candidates.add(s.getsockname()[0])
    except Exception:
        pass
    try:
        host = socket.gethostname()
        infos = socket.getaddrinfo(host, None, family=socket.AF_INET, type=socket.SOCK_STREAM)
        for info in infos:
            ip = info[4][0]
            candidates.add(ip)
    except Exception:
        pass

    out: list[str] = []
    for raw in sorted(candidates):
        try:
            ip = ipaddress.ip_address(raw)
        except ValueError:
            continue
        if ip.is_loopback:
            continue
        if ip.is_private or ip.is_link_local:
            out.append(raw)
    return out


def _format_url(scheme: str, host: str, port: Optional[int], path: str = "/") -> str:
    default_port = 80 if scheme == "http" else 443 if scheme == "https" else None
    port_part = f":{port}" if port and port != default_port else ""
    normalized_path = path if path.startswith("/") else f"/{path}"
    return f"{scheme}://{host}{port_part}{normalized_path}"


@app.exception_handler(StarletteHTTPException)
async def starlette_http_exception_handler(request: Request, exc: StarletteHTTPException):
    if exc.status_code == 404 and _is_frontend_request(request) and _wants_html(request):
        page = FRONTEND_DIR / "404.html"
        if page.exists():
            return FileResponse(page, status_code=404)
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    if isinstance(exc, HTTPException):
        return JSONResponse(
            status_code=exc.status_code,
            content=exc.detail if isinstance(exc.detail, dict) else {"error": str(exc.detail)},
        )
    if _is_frontend_request(request) and _wants_html(request):
        page = FRONTEND_DIR / "500.html"
        if page.exists():
            return FileResponse(page, status_code=500)
    traceback.print_exc()
    return JSONResponse(
        status_code=500,
        content=ErrorOut(error="Internal server error").model_dump(),
    )


COMMON_ERROR_RESPONSES = {
    422: {
        "description": "Ошибка валидации параметров запроса (неверный тип, значение вне допустимого набора).",
        "model": HTTPValidationErrorOut,
    },
    500: {
        "description": "Внутренняя ошибка сервера (БД, непредвиденное исключение).",
        "model": ErrorOut,
    },
}


@app.get(
    "/api/products",
    response_model=ProductListPageOut,
    summary="Список вентиляторов с фильтрами (постранично)",
    description=(
        "Возвращает страницу каталога: `items`, `total` по фильтрам, `limit`, `offset`. "
        "Выборка из PostgreSQL (LIMIT/OFFSET); фильтры совпадают с прежней логикой. "
        "Уникальные типы и диаметры — GET /api/products/facets."
    ),
    responses={
        200: {"description": "Страница списка и общее число записей по фильтрам.", "model": ProductListPageOut},
        **COMMON_ERROR_RESPONSES,
    },
    tags=["catalog"],
)
def api_products(
    q: Annotated[
        Optional[str],
        Query(description="Подстрока поиска (модель, типоразмер, тип); регистр не важен."),
    ] = None,
    fan_type: Annotated[
        Optional[str],
        Query(alias="type", description="Точное совпадение поля type из CSV."),
    ] = None,
    series: Annotated[
        Optional[str],
        Query(
            description="Точное совпадение типоразмера (поле size в БД): Bloom filter и точное множество id.",
        ),
    ] = None,
    diameter: Annotated[Optional[float], Query(description="Диаметр, мм.")] = None,
    minPrice: Annotated[Optional[float], Query(description="Минимальная цена.")] = None,
    maxPrice: Annotated[Optional[float], Query(description="Максимальная цена.")] = None,
    minPower: Annotated[Optional[float], Query(description="Минимальная мощность, Вт.")] = None,
    maxPower: Annotated[Optional[float], Query(description="Максимальная мощность, Вт.")] = None,
    minNoise: Annotated[Optional[float], Query(description="Минимальный уровень шума, дБ.")] = None,
    maxNoise: Annotated[Optional[float], Query(description="Максимальный уровень шума, дБ.")] = None,
    minDiameter: Annotated[Optional[float], Query(description="Минимальный диаметр, мм.")] = None,
    maxDiameter: Annotated[Optional[float], Query(description="Максимальный диаметр, мм.")] = None,
    minAirflow: Annotated[Optional[float], Query(description="Минимальный расход воздуха.")] = None,
    maxAirflow: Annotated[Optional[float], Query(description="Максимальный расход воздуха.")] = None,
    minPressure: Annotated[Optional[float], Query(description="Минимальное давление.")] = None,
    maxPressure: Annotated[Optional[float], Query(description="Максимальное давление.")] = None,
    sort: Annotated[
        Literal["price_asc", "price_desc"],
        Query(
            description="Сортировка по цене: price_asc — сначала дешёвые, price_desc — сначала дорогие.",
        ),
    ] = "price_asc",
    limit: Annotated[int, Query(description="Размер страницы (1–100).", ge=1, le=100)] = 48,
    offset: Annotated[int, Query(description="Смещение от начала отсортированного списка.", ge=0)] = 0,
):
    _ensure_catalog_sync_with_reindex()

    qn = normalize_whitespace(q).lower() or None
    tn = normalize_whitespace(fan_type) or None
    sn = normalize_whitespace(series) or None
    # Постраничный список всегда из БД: совпадает с COUNT и корректно обрабатывает NULL в числовых полях.
    # In-memory индекс (Bloom + bisect) остаётся для возможного расширения, но здесь не используется.
    with db_session() as conn:
        total = count_products_filtered(
            conn,
            q=qn,
            type_=tn,
            series=sn,
            diameter=diameter,
            min_price=minPrice,
            max_price=maxPrice,
            min_power=minPower,
            max_power=maxPower,
            min_noise=minNoise,
            max_noise=maxNoise,
            min_diameter=minDiameter,
            max_diameter=maxDiameter,
            min_airflow=minAirflow,
            max_airflow=maxAirflow,
            min_pressure=minPressure,
            max_pressure=maxPressure,
            sort=sort,
        )
        rows = list_products(
            conn,
            q=qn,
            type_=tn,
            series=sn,
            diameter=diameter,
            min_price=minPrice,
            max_price=maxPrice,
            min_power=minPower,
            max_power=maxPower,
            min_noise=minNoise,
            max_noise=maxNoise,
            min_diameter=minDiameter,
            max_diameter=maxDiameter,
            min_airflow=minAirflow,
            max_airflow=maxAirflow,
            min_pressure=minPressure,
            max_pressure=maxPressure,
            sort=sort,
            limit=limit,
            offset=offset,
        )
    return ProductListPageOut(
        items=[ProductOut.model_validate(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@app.get(
    "/api/products/facets",
    response_model=CatalogFacetsOut,
    summary="Значения для фильтров «тип» и «диаметр»",
    description="DISTINCT по каталогу; без пагинации, для заполнения выпадающих списков.",
    responses={200: {"description": "Списки уникальных типов и диаметров."}},
    tags=["catalog"],
)
def api_products_facets():
    with db_session() as conn:
        types_ = list_distinct_types(conn)
        diameters = list_distinct_diameters(conn)
    return CatalogFacetsOut(types=types_, diameters=diameters)


@app.get(
    "/api/products/{id_or_model}",
    response_model=ProductOut,
    summary="Один вентилятор по id или модели",
    description=(
        "Возвращает карточку вентилятора. Идентификатор в пути может быть: "
        "числовой id из CSV, полное имя модели или slug модели (как в _meta.model_slug)."
    ),
    responses={
        200: {"description": "Найденный вентилятор.", "model": ProductOut},
        404: {
            "description": "Вентилятор с указанным идентификатором не найден.",
            "model": ErrorOut,
        },
        **COMMON_ERROR_RESPONSES,
    },
    tags=["catalog"],
)
def api_product_detail(
    id_or_model: Annotated[
        str,
        PathParam(description="Идентификатор из CSV, полное имя модели или slug (_meta.model_slug)."),
    ],
):
    _ensure_catalog_sync_with_reindex()

    raw = normalize_whitespace(id_or_model)
    with db_session() as conn:
        p = get_by_id(conn, raw) or get_by_model_or_slug(conn, raw.lower(), slugify(raw))
    if not p:
        raise HTTPException(
            status_code=404,
            detail=ErrorOut(error="Product not found").model_dump(),
        )
    return ProductOut.model_validate(p)


@app.get(
    "/api/products/{id_or_model}/qp",
    response_model=list[QPPointOut],
    summary="Точки Q–P для модели (из диапазонов CSV)",
    description=(
        "Возвращает массив точек для графика Q–P (расход–давление). "
        "Точки строятся из диапазонов `airflow(min/max)` и `pressure(min/max)` в таблице products. "
        "Это аппроксимация для UI (линейная интерполяция)."
    ),
    responses={
        200: {"description": "Массив точек [{q,p}, ...].", "model": list[QPPointOut]},
        404: {"description": "Вентилятор не найден.", "model": ErrorOut},
        422: {"description": "Недостаточно данных для построения Q–P.", "model": HTTPValidationErrorOut},
        **COMMON_ERROR_RESPONSES,
    },
    tags=["catalog"],
)
def api_product_qp(
    id_or_model: Annotated[
        str,
        PathParam(description="Идентификатор из CSV, полное имя модели или slug (_meta.model_slug)."),
    ],
    points: Annotated[int, Query(description="Число точек на кривой (2–200).", ge=2, le=200)] = 25,
):
    _ensure_catalog_sync_with_reindex()

    raw = normalize_whitespace(id_or_model)
    with db_session() as conn:
        p = get_by_id(conn, raw) or get_by_model_or_slug(conn, raw.lower(), slugify(raw))
    if not p:
        raise HTTPException(status_code=404, detail=ErrorOut(error="Product not found").model_dump())

    q_min = p.get("airflow", {}).get("min")
    q_max = p.get("airflow", {}).get("max")
    p_min = p.get("pressure", {}).get("min")
    p_max = p.get("pressure", {}).get("max")

    # Требуем хотя бы один конец диапазона по каждой оси
    if (q_min is None and q_max is None) or (p_min is None and p_max is None):
        raise HTTPException(
            status_code=422,
            detail={"detail": [{"loc": ["path", "id_or_model"], "msg": "Not enough data for Q-P", "type": "value_error"}]},
        )

    if q_min is None:
        q_min = q_max
    if q_max is None:
        q_max = q_min
    if p_min is None:
        p_min = p_max
    if p_max is None:
        p_max = p_min

    q_min_f = float(q_min)
    q_max_f = float(q_max)
    p_min_f = float(p_min)
    p_max_f = float(p_max)

    # Для графика удобнее, когда P убывает при росте Q
    p_start = max(p_min_f, p_max_f)
    p_end = min(p_min_f, p_max_f)

    if points < 2:
        points = 2

    out: list[QPPointOut] = []
    for i in range(points):
        t = i / (points - 1)
        q = q_min_f + (q_max_f - q_min_f) * t
        pp = p_start + (p_end - p_start) * t
        out.append(QPPointOut(q=q, p=pp))
    return out


@app.get(
    "/api/health",
    response_model=HealthOut,
    summary="Проверка работоспособности",
    description="Возвращает признак ok и количество записей в таблице products.",
    responses={
        200: {"description": "Сервис доступен, БД отвечает.", "model": HealthOut},
        **COMMON_ERROR_RESPONSES,
    },
    tags=["system"],
)
def api_health():
    with db_session() as conn:
        n = count_products(conn)
    return HealthOut(ok=True, products=n)



@app.get(
    "/api/share-links",
    summary="Ссылки для открытия приложения в локальной сети",
    description="Возвращает ссылки с доступными локальными IPv4-адресами хоста для быстрого шаринга.",
    tags=["system"],
)
def api_share_links(request: Request):
    scheme = request.url.scheme or "http"
    port = request.url.port
    base_path = "/"
    urls: list[str] = []

    # Always include the URL from current request host.
    current_host = request.url.hostname or "localhost"
    urls.append(_format_url(scheme, current_host, port, base_path))

    # Add LAN candidates when accessed from localhost or single-IP host.
    for ip in _discover_local_ipv4_candidates():
        url = _format_url(scheme, ip, port, base_path)
        if url not in urls:
            urls.append(url)

    return {
        "urls": urls,
        "hint": "Откройте одну из ссылок на другом устройстве в той же локальной сети.",
    }



@app.post(
    "/api/export/pdf",
    summary="Экспорт сравнения в PDF (server-side)",
    description="Генерирует PDF через reportlab по списку id/моделей и отдает файл для скачивания.",
    responses={
        200: {"description": "PDF-файл сформирован и отправлен."},
        404: {"description": "Одна или несколько моделей не найдены.", "model": ErrorOut},
        422: {"description": "Некорректное тело запроса.", "model": HTTPValidationErrorOut},
        **COMMON_ERROR_RESPONSES,
    },
    tags=["export"],
)
def api_export_pdf(payload: PdfExportRequest):
    _ensure_catalog_sync_with_reindex()
    ids = [normalize_whitespace(v) for v in payload.ids if normalize_whitespace(v)]
    if not ids:
        raise HTTPException(status_code=422, detail={"detail": [{"loc": ["body", "ids"], "msg": "ids must not be empty", "type": "value_error"}]})

    products: list[dict[str, Any]] = []
    missing: list[str] = []
    with db_session() as conn:
        for raw in ids:
            item = get_by_id(conn, raw) or get_by_model_or_slug(conn, raw.lower(), slugify(raw))
            if item:
                products.append(item)
            else:
                missing.append(raw)

    if missing:
        raise HTTPException(
            status_code=404,
            detail=ErrorOut(error=f"Product not found: {', '.join(missing)}").model_dump(),
        )

    chart_png = _extract_chart_png_bytes(payload.chart_image_data_url)
    pdf_bytes = _build_compare_pdf(products, chart_png=chart_png)
    filename = _safe_pdf_filename(payload.filename)
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return StreamingResponse(BytesIO(pdf_bytes), media_type="application/pdf", headers=headers)


@app.get("/", include_in_schema=False)
def serve_index():
    """Каталог: фронтенд из ../frontend (тот же origin — API в config.js можно оставить пустым)."""
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/index.html", include_in_schema=False)
def serve_index_html():
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/product.html", include_in_schema=False)
def serve_product_page():
    return FileResponse(FRONTEND_DIR / "product.html")


@app.get("/compare.html", include_in_schema=False)
def serve_compare_page():
    return FileResponse(FRONTEND_DIR / "compare.html")


@app.get("/style.css", include_in_schema=False)
def serve_style():
    return FileResponse(FRONTEND_DIR / "style.css")


@app.get("/script.js", include_in_schema=False)
def serve_script():
    return FileResponse(FRONTEND_DIR / "script.js")


@app.get("/config.js", include_in_schema=False)
def serve_config():
    return FileResponse(FRONTEND_DIR / "config.js")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="0.0.0.0", port=PORT, reload=True)
