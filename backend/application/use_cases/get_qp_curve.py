"""
Сценарий: построить кривую Q-P (расход–давление) для вентилятора.

Оркестрирует получение продукта из репозитория и расчёт кривой
через доменный сервис qp_service.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from domain.interfaces.product_repository import AbstractProductRepository
from domain.services.qp_service import build_qp_curve, QPPoint
from application.use_cases.get_product import GetProductUseCase, ProductNotFoundError


class InsufficientQPDataError(Exception):
    """Недостаточно данных для построения кривой Q-P."""


@dataclass
class QPCurveQuery:
    """Параметры запроса кривой Q-P."""

    id_or_model: str
    slug: str
    points: int = 25
    target_rpm: Optional[float] = None


class GetQPCurveUseCase:
    """
    Построить кривую Q-P для вентилятора.

    Сначала получает продукт (через GetProductUseCase), затем делегирует
    построение кривой доменному сервису.
    """

    def __init__(self, product_repo: AbstractProductRepository) -> None:
        self._repo = product_repo
        self._get_product = GetProductUseCase(product_repo)

    def execute(self, query: QPCurveQuery) -> List[QPPoint]:
        """
        :raises ProductNotFoundError: если вентилятор не найден.
        :raises InsufficientQPDataError: если нет данных для кривой.
        """
        product: Dict[str, Any] = self._get_product.execute(query.id_or_model, query.slug)

        airflow = product.get("airflow", {})
        pressure = product.get("pressure", {})
        q_min = airflow.get("min")
        q_max = airflow.get("max")
        p_min = pressure.get("min")
        p_max = pressure.get("max")

        if (q_min is None and q_max is None) or (p_min is None and p_max is None):
            raise InsufficientQPDataError("Not enough Q-P data for this product")

        if q_min is None:
            q_min = q_max
        if q_max is None:
            q_max = q_min
        if p_min is None:
            p_min = p_max
        if p_max is None:
            p_max = p_min

        return build_qp_curve(
            q_min=float(q_min),
            q_max=float(q_max),
            p_min=float(p_min),
            p_max=float(p_max),
            fan_type=product.get("type"),
            pressure_coefficients=product.get("pressure_coefficients"),
            nominal_rpm=product.get("nominal_rpm"),
            target_rpm=query.target_rpm,
            points=query.points,
        )
