"""
Маршруты каталога: поиск вентиляторов, карточка, Q-P кривая, фасеты.

Все бизнес-операции делегируются Use Cases из application layer.
"""
from __future__ import annotations

import re
from typing import Annotated, Any, Literal, Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi import Path as PathParam

from presentation.api.schemas import (
    CatalogFacetsOut,
    ErrorOut,
    HTTPValidationErrorOut,
    ProductListPageOut,
    ProductOut,
    QPPointOut,
    SelectPointItemOut,
    SelectPointOut,
)
from application.use_cases.search_products import SearchProductsUseCase, SearchProductsQuery
from application.use_cases.get_product import GetProductUseCase, ProductNotFoundError
from application.use_cases.get_qp_curve import GetQPCurveUseCase, QPCurveQuery, InsufficientQPDataError
from application.use_cases.select_by_point import SelectByPointUseCase, SelectByPointQuery
from infrastructure.db.connection import get_connection, put_connection
from infrastructure.db.product_repository import (
    PgProductRepository,
    count_products,
    list_distinct_types,
    list_distinct_diameters,
)
from infrastructure.csv.sync import sync_catalog_from_csv
from infrastructure.search.catalog_index import CatalogIndex, set_catalog_index

import threading
from contextlib import contextmanager

router = APIRouter(tags=["catalog"])

_catalog_sync_lock = threading.Lock()


def _normalize_whitespace(value: Any) -> str:
    if value is None:
        return ""
    return " ".join(str(value).replace("\u00A0", " ").split())


def _slugify(value: str) -> str:
    s = _normalize_whitespace(value).lower()
    s = re.sub(r"[^\w]+", "-", s, flags=re.UNICODE)
    s = re.sub(r"-{2,}", "-", s).strip("-")
    return s


@contextmanager
def _db_session():
    conn = get_connection()
    try:
        yield conn
    finally:
        put_connection(conn)


def _ensure_catalog_sync(csv_path) -> None:
    """Проверка CSV и пересборка поискового индекса при переимпорте."""
    import logging
    logger = logging.getLogger(__name__)

    with _catalog_sync_lock:
        conn = get_connection()
        try:
            if sync_catalog_from_csv(conn, csv_path):
                try:
                    set_catalog_index(CatalogIndex.build(conn))
                except Exception:
                    logger.exception("Не удалось пересобрать поисковый индекс")
                    set_catalog_index(None)
        finally:
            put_connection(conn)


COMMON_ERROR_RESPONSES = {
    422: {
        "description": "Ошибка валидации параметров запроса.",
        "model": HTTPValidationErrorOut,
    },
    500: {
        "description": "Внутренняя ошибка сервера.",
        "model": ErrorOut,
    },
}


@router.get(
    "/api/products",
    response_model=ProductListPageOut,
    summary="Список вентиляторов с фильтрами (постранично)",
    description=(
        "Возвращает страницу каталога: `items`, `total` по фильтрам, `limit`, `offset`. "
        "Выборка из PostgreSQL (LIMIT/OFFSET)."
    ),
    responses={
        200: {"description": "Страница списка.", "model": ProductListPageOut},
        **COMMON_ERROR_RESPONSES,
    },
)
def api_products(
    q: Annotated[Optional[str], Query(description="Подстрока поиска (модель, типоразмер, тип).")] = None,
    fan_type: Annotated[Optional[str], Query(alias="type", description="Точное совпадение type.")] = None,
    series: Annotated[Optional[str], Query(description="Типоразмер (size).")] = None,
    diameter: Annotated[Optional[float], Query(description="Диаметр, мм.")] = None,
    minPrice: Annotated[Optional[float], Query(description="Минимальная цена.")] = None,
    maxPrice: Annotated[Optional[float], Query(description="Максимальная цена.")] = None,
    minPower: Annotated[Optional[float], Query(description="Минимальная мощность, Вт.")] = None,
    maxPower: Annotated[Optional[float], Query(description="Максимальная мощность, Вт.")] = None,
    minNoise: Annotated[Optional[float], Query(description="Минимальный шум, дБ.")] = None,
    maxNoise: Annotated[Optional[float], Query(description="Максимальный шум, дБ.")] = None,
    minDiameter: Annotated[Optional[float], Query(description="Минимальный диаметр, мм.")] = None,
    maxDiameter: Annotated[Optional[float], Query(description="Максимальный диаметр, мм.")] = None,
    minAirflow: Annotated[Optional[float], Query(description="Минимальный расход воздуха.")] = None,
    maxAirflow: Annotated[Optional[float], Query(description="Максимальный расход воздуха.")] = None,
    minPressure: Annotated[Optional[float], Query(description="Минимальное давление.")] = None,
    maxPressure: Annotated[Optional[float], Query(description="Максимальное давление.")] = None,
    sort: Annotated[
        Literal["price_asc", "price_desc"],
        Query(description="Сортировка: price_asc / price_desc."),
    ] = "price_asc",
    limit: Annotated[int, Query(description="Размер страницы (1–100).", ge=1, le=100)] = 48,
    offset: Annotated[int, Query(description="Смещение.", ge=0)] = 0,
):
    from config import CSV_PATH
    _ensure_catalog_sync(CSV_PATH)

    qn = _normalize_whitespace(q).lower() or None
    tn = _normalize_whitespace(fan_type) or None
    sn = _normalize_whitespace(series) or None

    with _db_session() as conn:
        repo = PgProductRepository(conn)
        uc = SearchProductsUseCase(repo)
        result = uc.execute(SearchProductsQuery(
            q=qn, type_=tn, series=sn, diameter=diameter,
            min_price=minPrice, max_price=maxPrice,
            min_power=minPower, max_power=maxPower,
            min_noise=minNoise, max_noise=maxNoise,
            min_diameter=minDiameter, max_diameter=maxDiameter,
            min_airflow=minAirflow, max_airflow=maxAirflow,
            min_pressure=minPressure, max_pressure=maxPressure,
            sort=sort, limit=limit, offset=offset,
        ))

    return ProductListPageOut(
        items=[ProductOut.model_validate(r) for r in result.items],
        total=result.total, limit=result.limit, offset=result.offset,
    )


@router.get(
    "/api/products/facets",
    response_model=CatalogFacetsOut,
    summary="Значения для фильтров «тип» и «диаметр»",
    description="DISTINCT по каталогу; для заполнения выпадающих списков.",
    responses={200: {"description": "Списки уникальных типов и диаметров."}},
)
def api_products_facets():
    with _db_session() as conn:
        types_ = list_distinct_types(conn)
        diameters = list_distinct_diameters(conn)
    return CatalogFacetsOut(types=types_, diameters=diameters)


@router.get(
    "/api/products/select-point",
    response_model=SelectPointOut,
    summary="Подбор по рабочей точке (Q, P)",
    description=(
        "Возвращает вентиляторы, у которых точка Q лежит в рабочем диапазоне, "
        "а кривая Q-P даёт давление не ниже P. Сортировка по запасу давления "
        "(первым — самое точное попадание)."
    ),
    responses={
        200: {"description": "Кандидаты с запасом давления.", "model": SelectPointOut},
        **COMMON_ERROR_RESPONSES,
    },
)
def api_products_select_point(
    point_q: Annotated[float, Query(description="Требуемый расход, м³/ч.", gt=0)],
    point_p: Annotated[float, Query(description="Требуемое давление, Па.", gt=0)],
    tolerance: Annotated[float, Query(description="Допустимый недобор давления, %.", ge=0, le=50)] = 0.0,
    limit: Annotated[int, Query(description="Максимум результатов.", ge=1, le=100)] = 20,
):
    from config import CSV_PATH
    _ensure_catalog_sync(CSV_PATH)

    with _db_session() as conn:
        repo = PgProductRepository(conn)
        uc = SelectByPointUseCase(repo)
        result = uc.execute(SelectByPointQuery(
            point_q=point_q, point_p=point_p, tolerance=tolerance, limit=limit,
        ))

    return SelectPointOut(
        items=[
            SelectPointItemOut(
                product=ProductOut.model_validate(it.product),
                p_available=it.p_available,
                reserve_percent=it.reserve_percent,
            )
            for it in result.items
        ],
        total_considered=result.total_considered,
        point={"q": point_q, "p": point_p},
    )


@router.get(
    "/api/products/{id_or_model}",
    response_model=ProductOut,
    summary="Один вентилятор по id или модели",
    responses={
        200: {"description": "Найденный вентилятор.", "model": ProductOut},
        404: {"description": "Вентилятор не найден.", "model": ErrorOut},
        **COMMON_ERROR_RESPONSES,
    },
)
def api_product_detail(
    id_or_model: Annotated[str, PathParam(description="id, имя модели или slug.")],
):
    from config import CSV_PATH
    _ensure_catalog_sync(CSV_PATH)

    raw = _normalize_whitespace(id_or_model)
    with _db_session() as conn:
        repo = PgProductRepository(conn)
        uc = GetProductUseCase(repo)
        try:
            product = uc.execute(raw, _slugify(raw))
        except ProductNotFoundError:
            raise HTTPException(
                status_code=404,
                detail=ErrorOut(error="Product not found").model_dump(),
            )
    return ProductOut.model_validate(product)


@router.get(
    "/api/products/{id_or_model}/qp",
    response_model=list[QPPointOut],
    summary="Точки Q–P для модели",
    description=(
        "Возвращает массив точек для графика Q–P. "
        "Полиномиальные коэффициенты или квадратичная кривая Безье + α по типу вентилятора."
    ),
    responses={
        200: {"description": "Массив точек [{q,p}, ...].", "model": list[QPPointOut]},
        404: {"description": "Вентилятор не найден.", "model": ErrorOut},
        422: {"description": "Недостаточно данных.", "model": HTTPValidationErrorOut},
        **COMMON_ERROR_RESPONSES,
    },
)
def api_product_qp(
    id_or_model: Annotated[str, PathParam(description="id, имя модели или slug.")],
    points: Annotated[int, Query(description="Число точек (2–200).", ge=2, le=200)] = 25,
    target_rpm: Annotated[Optional[float], Query(description="Целевые обороты для пересчёта по законам подобия.")] = None,
):
    from config import CSV_PATH
    _ensure_catalog_sync(CSV_PATH)

    raw = _normalize_whitespace(id_or_model)
    with _db_session() as conn:
        repo = PgProductRepository(conn)
        uc = GetQPCurveUseCase(repo)
        try:
            curve_points = uc.execute(QPCurveQuery(
                id_or_model=raw, slug=_slugify(raw),
                points=points, target_rpm=target_rpm,
            ))
        except ProductNotFoundError:
            raise HTTPException(status_code=404, detail=ErrorOut(error="Product not found").model_dump())
        except InsufficientQPDataError:
            raise HTTPException(
                status_code=422,
                detail={"detail": [{"loc": ["path", "id_or_model"], "msg": "Not enough data for Q-P", "type": "value_error"}]},
            )

    return [QPPointOut(q=pt.q, p=pt.p) for pt in curve_points]
