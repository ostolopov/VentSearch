"""
Абстрактный репозиторий вентиляторов (порт / port).

Инфраструктурный слой обязан предоставить конкретную реализацию этого интерфейса.
Прикладной слой работает только с этим интерфейсом — не знает о PostgreSQL.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional


class AbstractProductRepository(ABC):
    """Контракт для всех источников данных о вентиляторах."""

    @abstractmethod
    def list_products(
        self,
        *,
        q: Optional[str] = None,
        type_: Optional[str] = None,
        series: Optional[str] = None,
        diameter: Optional[float] = None,
        min_price: Optional[float] = None,
        max_price: Optional[float] = None,
        min_power: Optional[float] = None,
        max_power: Optional[float] = None,
        min_noise: Optional[float] = None,
        max_noise: Optional[float] = None,
        min_diameter: Optional[float] = None,
        max_diameter: Optional[float] = None,
        min_airflow: Optional[float] = None,
        max_airflow: Optional[float] = None,
        min_pressure: Optional[float] = None,
        max_pressure: Optional[float] = None,
        sort: str = "price_asc",
        limit: Optional[int] = None,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        """Возвращает страницу каталога с фильтрами и сортировкой."""

    @abstractmethod
    def count_products_filtered(
        self,
        *,
        q: Optional[str] = None,
        type_: Optional[str] = None,
        series: Optional[str] = None,
        diameter: Optional[float] = None,
        min_price: Optional[float] = None,
        max_price: Optional[float] = None,
        min_power: Optional[float] = None,
        max_power: Optional[float] = None,
        min_noise: Optional[float] = None,
        max_noise: Optional[float] = None,
        min_diameter: Optional[float] = None,
        max_diameter: Optional[float] = None,
        min_airflow: Optional[float] = None,
        max_airflow: Optional[float] = None,
        min_pressure: Optional[float] = None,
        max_pressure: Optional[float] = None,
        sort: str = "price_asc",
    ) -> int:
        """Число записей, соответствующих фильтрам."""

    @abstractmethod
    def get_by_id(self, id_value: str) -> Optional[Dict[str, Any]]:
        """Найти вентилятор по id (number из CSV)."""

    @abstractmethod
    def get_by_model_or_slug(
        self, model_value: str, slug_value: str
    ) -> Optional[Dict[str, Any]]:
        """Найти вентилятор по имени модели (регистронезависимо) или slug."""

    @abstractmethod
    def count_products(self) -> int:
        """Общее количество вентиляторов в хранилище."""

    @abstractmethod
    def list_distinct_types(self) -> List[str]:
        """Уникальные значения типа для фильтра."""

    @abstractmethod
    def list_distinct_diameters(self) -> List[float]:
        """Уникальные значения диаметра для фильтра."""

    @abstractmethod
    def fetch_all(self) -> List[Dict[str, Any]]:
        """Все записи для построения поискового индекса в памяти."""
