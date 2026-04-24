"""
VENTMASH — REST API на FastAPI (OpenAPI: /docs, /redoc).
Фронтенд обслуживается отдельно; CORS настраивается через CORS_ORIGINS.
"""
import logging
import re
import threading
import traceback
from contextlib import asynccontextmanager, contextmanager
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
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from api.schemas import (
    CatalogFacetsOut,
    ErrorOut,
    HealthOut,
    HTTPValidationErrorOut,
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
