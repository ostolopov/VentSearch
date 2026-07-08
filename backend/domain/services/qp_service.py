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
    "Осевой": 0.18,
    "ВЦ": 0.05,
    "ВР": 0.05,
    "Ц": 0.05,
}

ALPHA_DEFAULT: float = 0.10

# Осевые типы: характеристика с седловиной (провал слева от горба),
# как в каталогах ВО 13-284 / ВЕЗА ОСА. Регистр не важен.
AXIAL_TYPES: frozenset[str] = frozenset({"во", "вкоп", "уво", "осевой"})

# Форма седловины (кубическая Безье): позиции контрольных точек по Q (доли
# рабочего диапазона) и смещения по P (доли перепада давления).
AXIAL_DIP_POS: float = 0.25
AXIAL_DIP: float = 0.45
AXIAL_HUMP_POS: float = 0.60
AXIAL_HUMP: float = 0.50


def alpha_for_type(fan_type: str | None) -> float:
    """Вернуть коэффициент кривизны α для данного типа вентилятора."""
    if not fan_type:
        return ALPHA_DEFAULT
    return ALPHA_BY_TYPE.get(fan_type.strip(), ALPHA_DEFAULT)


def is_axial_type(fan_type: str | None) -> bool:
    """Осевой ли вентилятор (кривая с седловиной)."""
    if not fan_type:
        return False
    return fan_type.strip().lower() in AXIAL_TYPES


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

    axial = is_axial_type(fan_type)
    d_q = q_max - q_min
    d_p = p_start - p_end

    alpha = alpha_for_type(fan_type)
    q_ctrl = q_min + 0.5 * d_q
    p_ctrl = p_start + alpha * d_p

    # Кубическая Безье для осевых: провал (седловина) и горб внутри диапазона
    q_c1 = q_min + AXIAL_DIP_POS * d_q
    p_c1 = p_start - AXIAL_DIP * d_p
    q_c2 = q_min + AXIAL_HUMP_POS * d_q
    p_c2 = p_start + AXIAL_HUMP * d_p

    result: List[QPPoint] = []
    for i in range(points):
        t = i / (points - 1)
        one_minus_t = 1.0 - t

        if pressure_coefficients and len(pressure_coefficients) > 0:
            q_nom = q_min + d_q * t
            p_nom = sum(c * (q_nom ** idx) for idx, c in enumerate(pressure_coefficients))
        elif axial:
            mt2, t2 = one_minus_t ** 2, t ** 2
            q_nom = (one_minus_t * mt2) * q_min + 3 * mt2 * t * q_c1 + 3 * one_minus_t * t2 * q_c2 + (t * t2) * q_max
            p_nom = (one_minus_t * mt2) * p_start + 3 * mt2 * t * p_c1 + 3 * one_minus_t * t2 * p_c2 + (t * t2) * p_end
        else:
            q_nom = (one_minus_t ** 2) * q_min + 2 * t * one_minus_t * q_ctrl + (t ** 2) * q_max
            p_nom = (one_minus_t ** 2) * p_start + 2 * t * one_minus_t * p_ctrl + (t ** 2) * p_end

        result.append(QPPoint(q=q_nom * scale_factor, p=p_nom * (scale_factor ** 2)))

    return result


def pressure_at_flow(
    flow: float,
    *,
    q_min: float,
    q_max: float,
    p_min: float,
    p_max: float,
    fan_type: Optional[str] = None,
    pressure_coefficients: Optional[list] = None,
    nominal_rpm: Optional[float] = None,
    target_rpm: Optional[float] = None,
) -> Optional[float]:
    """
    Давление на кривой Q-P при заданном расходе (линейная интерполяция
    по плотной сетке — единообразно для всех форм кривой).
    None — если расход вне рабочего диапазона вентилятора.
    """
    curve = build_qp_curve(
        q_min=q_min, q_max=q_max, p_min=p_min, p_max=p_max,
        fan_type=fan_type, pressure_coefficients=pressure_coefficients,
        nominal_rpm=nominal_rpm, target_rpm=target_rpm, points=101,
    )
    if not curve:
        return None
    if flow < curve[0].q or flow > curve[-1].q:
        return None
    for a, b in zip(curve, curve[1:]):
        if a.q <= flow <= b.q:
            if b.q == a.q:
                return a.p
            k = (flow - a.q) / (b.q - a.q)
            return a.p + k * (b.p - a.p)
    return None
