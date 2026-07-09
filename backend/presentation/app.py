"""
Фабрика FastAPI-приложения (Presentation Layer).

Настраивает middleware, регистрирует маршруты, монтирует статику,
управляет жизненным циклом БД и поискового индекса.
"""
import base64
import logging
import os
import re
import socket
import ipaddress
import traceback
from contextlib import asynccontextmanager
from datetime import datetime
from io import BytesIO
from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv

# Загрузить secrets/.env.local до любых импортов config.
# Путь: backend/presentation/app.py → backend/ → repo_root/ → secrets/.env.local
_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
load_dotenv(_REPO_ROOT / "secrets" / ".env.local")

from fastapi import FastAPI, HTTPException, Request
from fastapi.encoders import jsonable_encoder
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
from reportlab.pdfgen import canvas as rl_canvas
from starlette.exceptions import HTTPException as StarletteHTTPException

from config import CORS_ORIGINS, CSV_PATH, PORT
from infrastructure.db.connection import get_connection, put_connection, init_pool, close_pool
from infrastructure.db.init_db import init_db
from infrastructure.db.bootstrap_admin import ensure_default_admin
from infrastructure.db.product_repository import count_products, PgProductRepository
from infrastructure.csv.sync import sync_catalog_from_csv
from infrastructure.search.catalog_index import CatalogIndex, set_catalog_index

from presentation.api.schemas import (
    CatalogFacetsOut, ErrorOut, HealthOut,
    HTTPValidationErrorOut, PdfExportRequest,
    ProductListPageOut, ProductOut, QPPointOut,
)
from presentation.api.routes.catalog import router as catalog_router
from presentation.api.routes.auth import router as auth_router
from presentation.api.routes.admin import router as admin_router

logger = logging.getLogger(__name__)

BACKEND_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BACKEND_DIR.parent / "frontend"
PHOTOS_DIR = BACKEND_DIR.parent / "photos"

DB_POOL_MIN = int(os.environ.get("DB_POOL_MIN", "1"))
DB_POOL_MAX = int(os.environ.get("DB_POOL_MAX", "10"))


# ---------------------------------------------------------------------------
# Startup / shutdown
# ---------------------------------------------------------------------------

def _startup_db() -> None:
    from config import DATABASE_URL
    init_pool(DATABASE_URL, minconn=DB_POOL_MIN, maxconn=DB_POOL_MAX)
    import psycopg2
    conn = get_connection()
    try:
        # Smoke-test + log version
        with conn.cursor() as cur:
            cur.execute("SELECT version();")
            row = cur.fetchone()
        short = ((row[0] if row else "").strip().split(",")[0]) if row else "unknown"
        logger.info("PostgreSQL подключена: %s", short)

        init_db(conn)
        ensure_default_admin(conn)
        sync_catalog_from_csv(conn, CSV_PATH)
        try:
            set_catalog_index(CatalogIndex.build(conn))
        except Exception:
            logger.exception("Не удалось построить поисковый индекс (Bloom + числовые оси)")
            set_catalog_index(None)
    except psycopg2.OperationalError as e:
        err = str(e).lower()
        if "password" in err or "fe_sendauth" in err:
            logger.error(
                "PostgreSQL: нет пароля или неверные учётные данные. "
                "Укажите DATABASE_URL в secrets/.env.prod."
            )
        raise
    finally:
        put_connection(conn)


def _warn_insecure_defaults() -> None:
    """Громко предупредить, если секреты не изменены с дефолтных значений."""
    from config import ADMIN_PASSWORD, JWT_SECRET

    if JWT_SECRET == "change-me-in-production":
        logger.warning(
            "SECURITY: JWT_SECRET имеет значение по умолчанию — любой в сети "
            "может подделать токен. Задайте JWT_SECRET в secrets/.env.local (или .env.prod)."
        )
    if ADMIN_PASSWORD == "admin123":
        logger.warning(
            "SECURITY: пароль админа по умолчанию (admin123). "
            "Задайте ADMIN_PASSWORD в secrets/.env.local (или .env.prod)."
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    _warn_insecure_defaults()
    _startup_db()
    yield
    set_catalog_index(None)
    close_pool()
    logger.info("Соединения с PostgreSQL закрыты.")


# ---------------------------------------------------------------------------
# PDF helpers (Presentation Layer — UI-specific)
# ---------------------------------------------------------------------------

def _normalize_ws(value: Any) -> str:
    if value is None:
        return ""
    return " ".join(str(value).replace("\u00A0", " ").split())


def _to_float(value: Any) -> Optional[float]:
    try:
        return None if value is None else float(value)
    except (TypeError, ValueError):
        return None


def _safe_pdf_filename(name: Optional[str]) -> str:
    base = _normalize_ws(name or "ventsearch-compare.pdf")
    if not base.lower().endswith(".pdf"):
        base = f"{base}.pdf"
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", base).strip("-")
    return cleaned or "ventsearch-compare.pdf"


def _extract_chart_png(data_url: Optional[str]) -> Optional[bytes]:
    if not data_url:
        return None
    raw = data_url.strip()
    if not raw.startswith("data:image/png;base64,"):
        return None
    try:
        return base64.b64decode(raw.split(",", 1)[1], validate=True)
    except Exception:
        return None


def _format_num(value: Any) -> str:
    num = _to_float(value)
    if num is None:
        return "—"
    if float(num).is_integer():
        return f"{int(num):,}".replace(",", " ")
    return f"{num:,.2f}".replace(",", " ").replace(".", ",")


def _pick_fonts() -> tuple[str, str]:
    candidates: list[tuple[Path, Path]] = [
        (BACKEND_DIR / "fonts" / "DejaVuSans.ttf", BACKEND_DIR / "fonts" / "DejaVuSans-Bold.ttf"),
    ]
    windir = os.environ.get("WINDIR") or os.environ.get("SystemRoot")
    if windir:
        wf = Path(windir) / "Fonts"
        candidates.extend([
            (wf / "arial.ttf", wf / "arialbd.ttf"),
            (wf / "segoeui.ttf", wf / "segoeuib.ttf"),
        ])
    candidates.extend([
        (Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
         Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")),
        (Path("/Library/Fonts/Arial Unicode.ttf"), Path("/Library/Fonts/Arial Bold.ttf")),
        (Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
         Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf")),
    ])
    for reg_path, bold_path in candidates:
        if not reg_path.exists():
            continue
        stem = reg_path.stem.replace(" ", "_")
        reg_name = f"VentPdfRegular-{stem}"
        bold_name = f"VentPdfBold-{bold_path.stem.replace(' ', '_')}" if bold_path.exists() else reg_name
        try:
            if reg_name not in pdfmetrics.getRegisteredFontNames():
                pdfmetrics.registerFont(TTFont(reg_name, str(reg_path)))
            if bold_path.exists() and bold_name not in pdfmetrics.getRegisteredFontNames():
                pdfmetrics.registerFont(TTFont(bold_name, str(bold_path)))
            return reg_name, bold_name
        except Exception:
            logger.warning("Не удалось зарегистрировать шрифт %s", reg_path, exc_info=True)
    return "Helvetica", "Helvetica-Bold"


def _build_compare_pdf(products: list[dict[str, Any]], chart_png: Optional[bytes] = None) -> bytes:
    buf = BytesIO()
    pdf = rl_canvas.Canvas(buf, pagesize=A4)
    page_w, page_h = A4
    left = 14 * mm
    right = page_w - 14 * mm
    width = right - left
    y = page_h - 14 * mm
    font_r, font_b = _pick_fonts()
    c_primary = colors.HexColor("#027bf3")
    c_surface = colors.HexColor("#f6f8fa")
    c_border = colors.HexColor("#e2e5e9")
    c_text = colors.HexColor("#111111")
    c_muted = colors.HexColor("#55595d")
    c_best = colors.HexColor("#e8f7e8")

    def new_page():
        nonlocal y
        pdf.showPage()
        y = page_h - 14 * mm

    def line(text, step=5.6 * mm, bold=False, color=None, size=10):
        nonlocal y
        if y < 20 * mm:
            new_page()
        pdf.setFillColor(color or c_text)
        pdf.setFont(font_b if bold else font_r, size)
        pdf.drawString(left, y, text)
        y -= step

    def card_header(title, subtitle=None):
        nonlocal y
        h = 18 * mm if subtitle else 13 * mm
        if y - h < 18 * mm:
            new_page()
        pdf.setFillColor(c_primary)
        pdf.roundRect(left, y - h, width, h, 3 * mm, stroke=0, fill=1)
        pdf.setFillColor(colors.white)
        pdf.setFont(font_b, 13)
        pdf.drawString(left + 4 * mm, y - 6.5 * mm, title)
        if subtitle:
            pdf.setFont(font_r, 9)
            pdf.drawString(left + 4 * mm, y - 12 * mm, subtitle)
        y -= h + 4 * mm

    def draw_row(label, values, highlights):
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
        pdf.setFont(font_b, 8.5)
        pdf.drawString(left + 1.8 * mm, y - 4.9 * mm, label)
        for idx, text in enumerate(values):
            x = left + label_w + idx * value_w
            pdf.setFillColor(c_best if idx in highlights else colors.white)
            pdf.rect(x, y - row_h, value_w, row_h, stroke=1, fill=1)
            pdf.setFillColor(c_text)
            pdf.setFont(font_r, 8)
            pdf.drawString(x + 1.2 * mm, y - 4.9 * mm, (_normalize_ws(text))[:36] or "—")
        y -= row_h

    single = len(products) == 1
    pdf.setAuthor("VENTSEARCH API")
    pdf.setTitle("VENTSEARCH Карточка модели" if single else "VENTSEARCH Сравнение моделей")
    card_header(
        "VENTSEARCH — карточка модели" if single else "VENTSEARCH — отчет по сравнению",
        f"Дата: {datetime.now().strftime('%d.%m.%Y %H:%M')}"
        + ("" if single else f"   |   Моделей: {len(products)}"),
    )

    if chart_png:
        try:
            image = ImageReader(BytesIO(chart_png))
            chart_h = 72 * mm
            if y - chart_h < 20 * mm:
                new_page()
            pdf.setStrokeColor(c_border)
            pdf.setFillColor(colors.white)
            pdf.roundRect(left, y - chart_h - 3 * mm, width, chart_h + 3 * mm, 2 * mm, stroke=1, fill=1)
            pdf.drawImage(image, left, y - chart_h, width=width, height=chart_h, preserveAspectRatio=True, mask="auto")
            y -= chart_h + 6 * mm
            line("График Q-P из интерфейса сравнения.", step=6.5 * mm, color=c_muted, size=9)
        except Exception:
            line("Не удалось встроить график Q-P.", step=6.5 * mm, color=c_muted, size=9)

    models = [_normalize_ws(p.get("model") or p.get("id") or "—") for p in products]
    types = [_normalize_ws(p.get("type") or "—") for p in products]
    sizes = [_normalize_ws(p.get("size") or "—") for p in products]
    diameters = [f"{_format_num(p.get('diameter'))} мм" if p.get("diameter") is not None else "—" for p in products]
    airflows = [_normalize_ws((p.get("airflow") or {}).get("raw") or "—") for p in products]
    pressures = [_normalize_ws((p.get("pressure") or {}).get("raw") or "—") for p in products]
    powers = [f"{_format_num(p.get('power'))} Вт" if p.get("power") is not None else "—" for p in products]
    noises = [f"{_format_num(p.get('noise_level'))} дБ" if p.get("noise_level") is not None else "—" for p in products]
    prices = [f"{_format_num(p.get('price'))} ₽" if p.get("price") is not None else "по запросу" for p in products]

    def min_idx(arr):
        valid = [(i, v) for i, v in enumerate(arr) if v is not None]
        if not valid:
            return set()
        t = min(v for _, v in valid)
        return {i for i, v in valid if v == t}

    def max_idx(arr):
        valid = [(i, v) for i, v in enumerate(arr) if v is not None]
        if not valid:
            return set()
        t = max(v for _, v in valid)
        return {i for i, v in valid if v == t}

    pvals = [_to_float(p.get("power")) for p in products]
    nvals = [_to_float(p.get("noise_level")) for p in products]
    prvals = [_to_float(p.get("price")) for p in products]
    af_max = [_to_float((p.get("airflow") or {}).get("max")) for p in products]
    pr_max = [_to_float((p.get("pressure") or {}).get("max")) for p in products]

    line("Сравнительная таблица (лучшие значения выделены):", step=7.0 * mm, bold=True, size=10)
    draw_row("Модель", models, set())
    draw_row("Тип", types, set())
    draw_row("Типоразмер", sizes, set())
    draw_row("Диаметр", diameters, set())
    draw_row("Расход", airflows, max_idx(af_max))
    draw_row("Давление", pressures, max_idx(pr_max))
    draw_row("Мощность", powers, min_idx(pvals))
    draw_row("Шум", noises, min_idx(nvals))
    draw_row("Цена", prices, min_idx(prvals))

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
        pdf.setFont(font_b, 10)
        pdf.drawString(left + 3 * mm, y - 6 * mm, f"{idx}. {_normalize_ws(p.get('model') or p.get('id') or '—')}"[:95])
        pdf.setFillColor(c_muted)
        pdf.setFont(font_r, 8.5)
        pdf.drawString(left + 3 * mm, y - 11 * mm, f"ID: {_normalize_ws(p.get('id') or '—')}")
        pdf.drawString(left + 3 * mm, y - 15.5 * mm,
                       f"Тип: {_normalize_ws(p.get('type') or '—')}   |   Типоразмер: {_normalize_ws(p.get('size') or '—')}")
        pdf.drawString(left + 3 * mm, y - 20 * mm,
                       f"Расход: {airflows[idx-1]}   |   Давление: {pressures[idx-1]}")
        pdf.drawString(left + 3 * mm, y - 24.5 * mm,
                       f"Мощность: {powers[idx-1]}   |   Шум: {noises[idx-1]}   |   Цена: {prices[idx-1]}")
        y -= card_h + 3.5 * mm

    pdf.save()
    data = buf.getvalue()
    buf.close()
    return data


# ---------------------------------------------------------------------------
# FastAPI application
# ---------------------------------------------------------------------------

def create_app() -> FastAPI:
    app = FastAPI(
        title="VENTSEARCH API",
        description=(
            "B2B-каталог промышленных вентиляторов. "
            "Данные в PostgreSQL; CSV синхронизируется по mtime/размеру и SHA-256."
        ),
        version="0.3.0",
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

    app.include_router(catalog_router)
    app.include_router(auth_router)
    app.include_router(admin_router)

    # --- Exception handlers ---

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError):
        # exc.errors() у pydantic v2 кладёт в ctx.error сам объект исключения
        # (например, при raise ValueError(...) в @model_validator) — он не
        # сериализуется обычным json.dumps внутри JSONResponse, нужен jsonable_encoder
        return JSONResponse(status_code=422, content={"detail": jsonable_encoder(exc.errors())})

    @app.exception_handler(StarletteHTTPException)
    async def starlette_http_exception_handler(request: Request, exc: StarletteHTTPException):
        if exc.status_code == 404 and _is_frontend_request(request) and _wants_html(request):
            page = FRONTEND_DIR / "404.html"
            if page.exists():
                return FileResponse(page, status_code=404)
        # headers исключения (например, Retry-After у 429) должны дойти до клиента
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.detail},
            headers=getattr(exc, "headers", None),
        )

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
        return JSONResponse(status_code=500, content=ErrorOut(error="Internal server error").model_dump())

    # --- System routes ---

    @app.get("/api/health", response_model=HealthOut, summary="Проверка работоспособности", tags=["system"])
    def api_health():
        from config import DEMO_MODE

        conn = get_connection()
        try:
            n = count_products(conn)
        finally:
            put_connection(conn)
        return HealthOut(ok=True, products=n, demo_mode=DEMO_MODE)

    @app.get("/api/share-links", summary="Ссылки для открытия в локальной сети", tags=["system"])
    def api_share_links(request: Request):
        scheme = request.url.scheme or "http"
        port = request.url.port
        current_host = request.url.hostname or "localhost"
        current_url = _format_url(scheme, current_host, port)

        # Реально доступные с других устройств адреса — из сетевых интерфейсов.
        lan_urls = []
        for ip in _discover_local_ips():
            url = _format_url(scheme, ip, port)
            if url not in lan_urls:
                lan_urls.append(url)

        try:
            current_is_loopback = ipaddress.ip_address(current_host).is_loopback
        except ValueError:
            current_is_loopback = current_host.lower() == "localhost"

        if current_is_loopback:
            # localhost/127.0.0.1 работает только на этом же компьютере — не
            # ставим первым (это как раз то, что копируется в буфер обмена);
            # первым должен быть реально открывающийся с других устройств адрес.
            urls = lan_urls + ([current_url] if current_url not in lan_urls else [])
        else:
            urls = [current_url] + [u for u in lan_urls if u != current_url]
        if not urls:
            urls = [current_url]

        return {"urls": urls, "hint": "Откройте на другом устройстве в той же локальной сети."}

    # --- Export ---

    @app.post("/api/export/pdf", summary="Экспорт сравнения в PDF", tags=["export"])
    def api_export_pdf(payload: PdfExportRequest):
        from infrastructure.csv.sync import sync_catalog_from_csv
        from presentation.api.routes.catalog import _ensure_catalog_sync
        _ensure_catalog_sync(CSV_PATH)

        ids = [_normalize_ws(v) for v in payload.ids if _normalize_ws(v)]
        if not ids:
            raise HTTPException(
                status_code=422,
                detail={"detail": [{"loc": ["body", "ids"], "msg": "ids must not be empty", "type": "value_error"}]},
            )
        products_list: list[dict[str, Any]] = []
        missing: list[str] = []
        conn = get_connection()
        try:
            repo = PgProductRepository(conn)
            for raw in ids:
                item = repo.get_by_id(raw) or repo.get_by_model_or_slug(raw.lower(), _slugify_local(raw))
                if item:
                    products_list.append(item)
                else:
                    missing.append(raw)
        finally:
            put_connection(conn)

        if missing:
            raise HTTPException(
                status_code=404,
                detail=ErrorOut(error=f"Product not found: {', '.join(missing)}").model_dump(),
            )
        chart_png = _extract_chart_png(payload.chart_image_data_url)
        pdf_bytes = _build_compare_pdf(products_list, chart_png=chart_png)
        filename = _safe_pdf_filename(payload.filename)
        headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
        return StreamingResponse(BytesIO(pdf_bytes), media_type="application/pdf", headers=headers)

    # --- Frontend static routes ---

    @app.get("/", include_in_schema=False)
    def serve_index():
        # HTML не кэшируем: браузер хранит страницы с query-string (product.html?id=…)
        # по отдельности и после обновлений показывает смесь старой и новой вёрстки
        return FileResponse(FRONTEND_DIR / "index.html", headers={"Cache-Control": "no-cache"})

    for name in [
        "index.html", "product.html", "compare.html", "project.html",
        "admin.html", "auth.html", "delivery.html",
        "admin-page.js", "auth-page.js", "site-auth.js",
        "admin.js", "auth.js", "style.css", "script.js", "config.js",
        "site-layout.js",
    ]:
        _make_static_route(app, name)

    return app


def _make_static_route(app: FastAPI, filename: str) -> None:
    path = f"/{filename}"
    # no-cache заставляет браузер перепроверять файл (ETag/304) — после обновления
    # кода не остаётся закэшированных страниц со старой вёрсткой
    headers = {"Cache-Control": "no-cache"} if filename.endswith((".html", ".js", ".css")) else None

    @app.get(path, include_in_schema=False)
    def _serve(f=filename, h=headers):
        return FileResponse(FRONTEND_DIR / f, headers=h)

    _serve.__name__ = f"serve_{filename.replace('.', '_').replace('-', '_')}"


def _wants_html(request: Request) -> bool:
    accept = (request.headers.get("accept") or "").lower()
    return "text/html" in accept or "*/*" in accept


def _is_frontend_request(request: Request) -> bool:
    return not (request.url.path or "").startswith("/api")


def _discover_local_ips() -> list[str]:
    candidates: set[str] = set()
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            candidates.add(s.getsockname()[0])
    except Exception:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, family=socket.AF_INET, type=socket.SOCK_STREAM):
            candidates.add(info[4][0])
    except Exception:
        pass
    out: list[str] = []
    for raw in sorted(candidates):
        try:
            ip = ipaddress.ip_address(raw)
        except ValueError:
            continue
        if not ip.is_loopback and (ip.is_private or ip.is_link_local):
            out.append(raw)
    return out


def _format_url(scheme: str, host: str, port: Optional[int], path: str = "/") -> str:
    default_port = 80 if scheme == "http" else 443 if scheme == "https" else None
    port_part = f":{port}" if port and port != default_port else ""
    normalized_path = path if path.startswith("/") else f"/{path}"
    return f"{scheme}://{host}{port_part}{normalized_path}"


def _slugify_local(value: str) -> str:
    s = _normalize_ws(value).lower()
    s = re.sub(r"[^\w]+", "-", s, flags=re.UNICODE)
    return re.sub(r"-{2,}", "-", s).strip("-")


# Module-level app instance
app = create_app()
