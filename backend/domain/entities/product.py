"""
Доменная сущность: Вентилятор (Product).

Чистый бизнес-объект без зависимостей на БД, HTTP или внешние библиотеки.
Представляет промышленный вентилятор из каталога.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional


@dataclass(frozen=True)
class AirflowRange:
    """Диапазон расхода воздуха (м³/ч)."""

    min: Optional[float] = None
    max: Optional[float] = None
    raw: str = ""


@dataclass(frozen=True)
class PressureRange:
    """Диапазон статического давления (Па)."""

    min: Optional[float] = None
    max: Optional[float] = None
    raw: str = ""


@dataclass
class Product:
    """
    Агрегат «Вентилятор».

    Содержит все характеристики из каталогового CSV плюс вычисленные поля.
    Инварианты: id и number обязательны; type/model/size могут быть пустыми строками.
    """

    id: str
    number: str
    type: str = ""
    model: str = ""
    size: str = ""
    diameter: Optional[float] = None
    airflow: AirflowRange = field(default_factory=AirflowRange)
    pressure: PressureRange = field(default_factory=PressureRange)
    power: Optional[float] = None
    noise_level: Optional[float] = None
    price: Optional[float] = None
    nominal_rpm: Optional[float] = None
    pressure_coefficients: Optional[List[float]] = None
    efficiency_coefficients: Optional[List[float]] = None
    model_slug: str = ""

    def has_qp_data(self) -> bool:
        """True если есть достаточно данных для построения кривой Q-P."""
        has_airflow = self.airflow.min is not None or self.airflow.max is not None
        has_pressure = self.pressure.min is not None or self.pressure.max is not None
        return has_airflow and has_pressure
