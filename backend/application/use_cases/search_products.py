"""
Сценарий: поиск и фильтрация вентиляторов из каталога.

Оркестрирует запрос к репозиторию через абстрактный интерфейс.
Не знает о PostgreSQL, CSV или HTTP.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from domain.interfaces.product_repository import AbstractProductRepository


@dataclass
class SearchProductsQuery:
    """Параметры запроса к каталогу."""

    q: Optional[str] = None
    type_: Optional[str] = None
    series: Optional[str] = None
    diameter: Optional[float] = None
    min_price: Optional[float] = None
    max_price: Optional[float] = None
    min_power: Optional[float] = None
    max_power: Optional[float] = None
    min_noise: Optional[float] = None
    max_noise: Optional[float] = None
    min_diameter: Optional[float] = None
    max_diameter: Optional[float] = None
    min_airflow: Optional[float] = None
    max_airflow: Optional[float] = None
    min_pressure: Optional[float] = None
    max_pressure: Optional[float] = None
    sort: str = "price_asc"
    limit: int = 48
    offset: int = 0


@dataclass
class SearchProductsResult:
    """Страница результатов каталога."""

    items: List[Dict[str, Any]] = field(default_factory=list)
    total: int = 0
    limit: int = 48
    offset: int = 0


class SearchProductsUseCase:
    """
    Поиск вентиляторов по фильтрам с пагинацией.

    Принимает абстрактный репозиторий — не привязан к конкретной БД.
    """

    def __init__(self, product_repo: AbstractProductRepository) -> None:
        self._repo = product_repo

    def execute(self, query: SearchProductsQuery) -> SearchProductsResult:
        filter_kwargs = dict(
            q=query.q,
            type_=query.type_,
            series=query.series,
            diameter=query.diameter,
            min_price=query.min_price,
            max_price=query.max_price,
            min_power=query.min_power,
            max_power=query.max_power,
            min_noise=query.min_noise,
            max_noise=query.max_noise,
            min_diameter=query.min_diameter,
            max_diameter=query.max_diameter,
            min_airflow=query.min_airflow,
            max_airflow=query.max_airflow,
            min_pressure=query.min_pressure,
            max_pressure=query.max_pressure,
            sort=query.sort,
        )
        total = self._repo.count_products_filtered(**filter_kwargs)
        items = self._repo.list_products(**filter_kwargs, limit=query.limit, offset=query.offset)
        return SearchProductsResult(
            items=items,
            total=total,
            limit=query.limit,
            offset=query.offset,
        )
