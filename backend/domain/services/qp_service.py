"""
Доменный сервис: Q-P кривые (расход–давление).

Содержит бизнес-знания о форме аэродинамических характеристик разных типов вентиляторов.
α — коэффициент кривизны Безье: чем выше, тем «выпуклее» кривая давления.

Зависимости: только стандартная библиотека. Не знает о БД, HTTP или форматах данных.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional


# Кривизна кривой Q-P по типу вентилятора (подобрана по паспортным характеристикам)
ALPHA_BY_TYPE: dict[str, float] = {
    "ВО": 0.18,
    "ВКОП": 0.15,
    "УВО": 0.18,
    "ВЦ": 0.05,
    "ВР": 0.05,
    "Ц": 0.05,
}

ALPHA_DEFAULT: float = 0.10


def alpha_for_type(fan_type: str | None) -> float:
    """Вернуть коэффициент кривизны α для данного типа вентилятора."""
    if not fan_type:
        return ALPHA_DEFAULT
    return ALPHA_BY_TYPE.get(fan_type.strip(), ALPHA_DEFAULT)


@dataclass(frozen=True)
class QPPoint:
    """Точка на кривой Q-P (расход, давление)."""

    q: float
    p: float


def build_qp_curve(
    *,
    q_min: float,
    q_max: float,
    p_min: float,
    p_max: float,
    fan_type: Optional[str] = None,
    pressure_coefficients: Optional[list] = None,
    nominal_rpm: Optional[float] = None,
    target_rpm: Optional[float] = None,
    points: int = 25,
) -> List[QPPoint]:
    """
    Построить кривую Q-P из диапазонов расхода и давления.

    Два режима:
    1. Полиномиальные коэффициенты (pressure_coefficients) — точная кривая из паспорта.
    2. Квадратичная кривая Безье — аппроксимация по диапазонам, α зависит от типа.

    При наличии target_rpm выполняется пересчёт по законам подобия:
      Q ~ n, P ~ n².
    """
    if points < 2:
        points = 2

    scale_factor = 1.0
    if target_rpm is not None and nominal_rpm is not None and nominal_rpm > 0:
        scale_factor = target_rpm / nominal_rpm

    p_start = max(p_min, p_max)
    p_end = min(p_min, p_max)

    alpha = alpha_for_type(fan_type)
    q_ctrl = q_min + 0.5 * (q_max - q_min)
    p_ctrl = p_start + alpha * (p_start - p_end)

    result: List[QPPoint] = []
    for i in range(points):
        t = i / (points - 1)

        if pressure_coefficients and len(pressure_coefficients) > 0:
            q_nom = q_min + (q_max - q_min) * t
            p_nom = sum(c * (q_nom ** idx) for idx, c in enumerate(pressure_coefficients))
        else:
            one_minus_t = 1.0 - t
            q_nom = (one_minus_t ** 2) * q_min + 2 * t * one_minus_t * q_ctrl + (t ** 2) * q_max
            p_nom = (one_minus_t ** 2) * p_start + 2 * t * one_minus_t * p_ctrl + (t ** 2) * p_end

        result.append(QPPoint(q=q_nom * scale_factor, p=p_nom * (scale_factor ** 2)))

    return result
