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
    """Рабочая точка, допуск по давлению (%) и ограничение размера выдачи.

    Дополнительные фильтры каталога (поиск по названию, тип, типоразмер, цена
    и т.д.) сужают множество кандидатов ДО проверки кривой — подбор по точке и
    обычные фильтры работают вместе, а не взаимоисключающе. Диапазоны расхода
    здесь не принимаются: расход уже задан самой точкой Q.
    """

    point_q: float
    point_p: float
    tolerance: float = 0.0
    limit: int = 20
    q: str | None = None
    type_: str | None = None
    series: str | None = None
    diameter: float | None = None
    min_price: float | None = None
    max_price: float | None = None
    min_power: float | None = None
    max_power: float | None = None
    min_noise: float | None = None
    max_noise: float | None = None


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
        # + пользовательские фильтры каталога, если заданы
        candidates = self._repo.list_products(
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
                model=p.get("model"),
                pressure_coefficients=p.get("pressure_coefficients"),
                nominal_rpm=p.get("nominal_rpm"),
            )
            if p_avail is None:
                continue

            # Допуск разрешает недобор давления до tolerance % (запас будет < 0)
            min_pressure = query.point_p * (1.0 - max(query.tolerance, 0.0) / 100.0)
            if p_avail < min_pressure:
                continue

            reserve = (p_avail - query.point_p) / query.point_p * 100.0
            items.append(SelectByPointItem(
                product=p, p_available=round(p_avail, 1), reserve_percent=round(reserve, 1),
            ))

        # По точности попадания: |запас| по возрастанию — точная модель первой,
        # дальше — с растущим запасом или дефицитом
        items.sort(key=lambda it: abs(it.reserve_percent))
        return SelectByPointResult(
            items=items[: query.limit],
            total_considered=len(candidates),
        )
