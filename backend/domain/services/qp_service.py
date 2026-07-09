"""
Доменный сервис: Q-P кривые (расход–давление).

Содержит бизнес-знания о форме аэродинамических характеристик разных типов вентиляторов.
α — коэффициент кривизны Безье: чем выше, тем «выпуклее» кривая давления.

Зависимости: только стандартная библиотека (json/re — из stdlib). Не знает о БД, HTTP
или форматах данных.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Tuple


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


# Оцифрованные реальные формы кривых (ВО 13-284, каталог производителя):
# для пары (число лопастей, угол установки) — точки (q_frac, p_frac) в
# диапазоне [0,1]x[0,1], снятые с растровых графиков и очищенные от «провала»
# трассировки. По закону подобия безразмерная форма кривой не зависит от
# типоразмера/оборотов — один и тот же профиль накладывается на q_min..q_max
# и p_start..p_end конкретного вентилятора.
_SHAPES_PATH = Path(__file__).parent / "qp_shapes_vo13284.json"
_MODEL_BLADE_ANGLE_RE = re.compile(r"(\d+к?)/(\d+)°")


def _load_digitized_shapes() -> dict:
    try:
        with _SHAPES_PATH.open("r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


_DIGITIZED_SHAPES: dict = _load_digitized_shapes()


def shape_points_for_model(model: str | None) -> Optional[List[Tuple[float, float]]]:
    """
    Найти оцифрованную форму кривой по числу лопастей и углу установки,
    извлечённым из строки модели (например, «ВО 13-284-6/20°-...» → лопасти
    «6», угол «20»). None — если для этой модели нет оцифрованных данных
    (используется параметрическая кривая Безье как раньше).
    """
    if not model:
        return None
    m = _MODEL_BLADE_ANGLE_RE.search(model)
    if not m:
        return None
    blade_group = _DIGITIZED_SHAPES.get(m.group(1))
    if not blade_group:
        return None
    points = blade_group.get(m.group(2))
    if not points:
        return None
    return [(q, p) for q, p in points]


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


def _linear_interp(x: float, xs: List[float], ys: List[float]) -> float:
    """Кусочно-линейная интерполяция по возрастающей сетке xs (без numpy)."""
    if x <= xs[0]:
        return ys[0]
    if x >= xs[-1]:
        return ys[-1]
    for i in range(1, len(xs)):
        if x <= xs[i]:
            x0, x1 = xs[i - 1], xs[i]
            y0, y1 = ys[i - 1], ys[i]
            if x1 == x0:
                return y0
            k = (x - x0) / (x1 - x0)
            return y0 + k * (y1 - y0)
    return ys[-1]


def build_qp_curve(
    *,
    q_min: float,
    q_max: float,
    p_min: float,
    p_max: float,
    fan_type: Optional[str] = None,
    model: Optional[str] = None,
    pressure_coefficients: Optional[list] = None,
    nominal_rpm: Optional[float] = None,
    target_rpm: Optional[float] = None,
    points: int = 25,
) -> List[QPPoint]:
    """
    Построить кривую Q-P из диапазонов расхода и давления.

    Приоритет источника формы кривой:
    1. Полиномиальные коэффициенты (pressure_coefficients) — точная кривая из паспорта.
    2. Оцифрованная реальная форма (по числу лопастей/углу из model) — кусочно-линейная
       интерполяция по реальным точкам с растровых графиков каталога.
    3. Квадратичная/кубическая кривая Безье — аппроксимация по диапазонам, α зависит от типа.

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

    shape_points = None
    if not (pressure_coefficients and len(pressure_coefficients) > 0):
        shape_points = shape_points_for_model(model)
    shape_qs = [pt[0] for pt in shape_points] if shape_points else None
    shape_ps = [pt[1] for pt in shape_points] if shape_points else None

    result: List[QPPoint] = []
    for i in range(points):
        t = i / (points - 1)
        one_minus_t = 1.0 - t

        if shape_qs is not None:
            q_nom = q_min + d_q * t
            p_frac = _linear_interp(t, shape_qs, shape_ps)
            p_nom = p_end + p_frac * d_p
        elif pressure_coefficients and len(pressure_coefficients) > 0:
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
    model: Optional[str] = None,
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
        fan_type=fan_type, model=model, pressure_coefficients=pressure_coefficients,
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
