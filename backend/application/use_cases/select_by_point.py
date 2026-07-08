"""
Сценарий: подбор вентиляторов по рабочей точке (Q, P).

Классический каталожный подбор: заказчик знает требуемый расход Q (м³/ч)
и давление сети P (Па). Подходит вентилятор, у которого точка Q лежит
в рабочем диапазоне, а кривая Q-P в этой точке даёт давление не ниже P.
Результат сортируется по запасу давления: чем меньше запас, тем точнее
попадание (первым идёт самый экономичный подходящий вариант).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List

from domain.interfaces.product_repository import AbstractProductRepository
from domain.services.qp_service import pressure_at_flow


@dataclass
class SelectByPointQuery:
    """Рабочая точка и ограничение размера выдачи."""

    point_q: float
    point_p: float
    limit: int = 20


@dataclass
class SelectByPointItem:
    """Кандидат: продукт + давление на кривой в точке Q и запас в %."""

    product: Dict[str, Any]
    p_available: float
    reserve_percent: float


@dataclass
class SelectByPointResult:
    items: List[SelectByPointItem] = field(default_factory=list)
    total_considered: int = 0


class SelectByPointUseCase:
    """Подбор по точке поверх абстрактного репозитория."""

    def __init__(self, product_repo: AbstractProductRepository) -> None:
        self._repo = product_repo

    def execute(self, query: SelectByPointQuery) -> SelectByPointResult:
        # Кандидаты: рабочий диапазон расхода накрывает точку Q
        # (min_airflow=Q отсекает airflow_max < Q, max_airflow=Q — airflow_min > Q)
        candidates = self._repo.list_products(
            min_airflow=query.point_q,
            max_airflow=query.point_q,
            sort="price_asc",
            limit=None,
            offset=0,
        )

        items: List[SelectByPointItem] = []
        for p in candidates:
            airflow = p.get("airflow") or {}
            pressure = p.get("pressure") or {}
            q_min, q_max = airflow.get("min"), airflow.get("max")
            p_min, p_max = pressure.get("min"), pressure.get("max")
            if q_min is None or q_max is None or p_min is None or p_max is None:
                continue

            p_avail = pressure_at_flow(
                query.point_q,
                q_min=float(q_min), q_max=float(q_max),
                p_min=float(p_min), p_max=float(p_max),
                fan_type=p.get("type"),
                pressure_coefficients=p.get("pressure_coefficients"),
                nominal_rpm=p.get("nominal_rpm"),
            )
            if p_avail is None or p_avail < query.point_p:
                continue

            reserve = (p_avail - query.point_p) / query.point_p * 100.0
            items.append(SelectByPointItem(
                product=p, p_available=round(p_avail, 1), reserve_percent=round(reserve, 1),
            ))

        items.sort(key=lambda it: it.reserve_percent)
        return SelectByPointResult(
            items=items[: query.limit],
            total_considered=len(candidates),
        )
