"""
PostgreSQL-реализация репозитория вентиляторов.

Реализует AbstractProductRepository из domain/interfaces.
Содержит паттерн Strategy для сортировки (OCP).
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

import psycopg2
from psycopg2.extras import RealDictCursor

from domain.interfaces.product_repository import AbstractProductRepository


# ---------------------------------------------------------------------------
# Strategy Pattern — сортировка
# ---------------------------------------------------------------------------

class SortStrategy:
    """Базовый класс стратегии сортировки."""

    def order_by_sql(self) -> str:
        raise NotImplementedError


class PriceAscStrategy(SortStrategy):
    def order_by_sql(self) -> str:
        return "price ASC NULLS LAST, model ASC"


class PriceDescStrategy(SortStrategy):
    def order_by_sql(self) -> str:
        return "price DESC NULLS LAST, model ASC"


class PowerAscStrategy(SortStrategy):
    def order_by_sql(self) -> str:
        return "power ASC NULLS LAST, model ASC"


class ModelAscStrategy(SortStrategy):
    def order_by_sql(self) -> str:
        return "model ASC"


SORT_STRATEGIES: Dict[str, SortStrategy] = {
    "price_asc": PriceAscStrategy(),
    "price_desc": PriceDescStrategy(),
    "power_asc": PowerAscStrategy(),
    "model_asc": ModelAscStrategy(),
}

DEFAULT_SORT_KEY = "price_asc"


def _get_sort_strategy(sort_key: str) -> SortStrategy:
    return SORT_STRATEGIES.get(sort_key, SORT_STRATEGIES[DEFAULT_SORT_KEY])


# ---------------------------------------------------------------------------
# Row → dict mapping
# ---------------------------------------------------------------------------

def _row_to_product_dict(row: Dict[str, Any]) -> Dict[str, Any]:
    """Преобразует строку БД в структуру, совместимую с ProductOut."""
    return {
        "id": row["id"],
        "number": row["number"],
        "type": row["type"] or "",
        "model": row["model"] or "",
        "size": row["size"] or "",
        "diameter": float(row["diameter"]) if row["diameter"] is not None else None,
        "airflow": {
            "min": float(row["airflow_min"]) if row["airflow_min"] is not None else None,
            "max": float(row["airflow_max"]) if row["airflow_max"] is not None else None,
            "raw": row["airflow_raw"] or "",
        },
        "pressure": {
            "min": float(row["pressure_min"]) if row["pressure_min"] is not None else None,
            "max": float(row["pressure_max"]) if row["pressure_max"] is not None else None,
            "raw": row["pressure_raw"] or "",
        },
        "power": float(row["power"]) if row["power"] is not None else None,
        "noise_level": float(row["noise_level"]) if row["noise_level"] is not None else None,
        "price": float(row["price"]) if row["price"] is not None else None,
        "nominal_rpm": float(row["nominal_rpm"]) if row.get("nominal_rpm") is not None else None,
        "pressure_coefficients": row.get("pressure_coefficients"),
        "efficiency_coefficients": row.get("efficiency_coefficients"),
        "dimensions": row.get("dimensions"),
        "_raw": {
            "diameter": row["raw_diameter"] or "",
            "efficiency": row["raw_efficiency"] or "",
            "pressure": row["raw_pressure"] or "",
            "power": str(row["raw_power"]) if row["raw_power"] is not None else "",
            "noise_level": str(row["raw_noise_level"]) if row["raw_noise_level"] is not None else "",
            "price": str(row["raw_price"]) if row["raw_price"] is not None else "",
        },
        "_meta": {
            "model_slug": row["model_slug"] or "",
        },
    }


# ---------------------------------------------------------------------------
# WHERE clause builder
# ---------------------------------------------------------------------------

_SELECT_COLS = (
    "id, number, type, model, size, diameter, "
    "airflow_min, airflow_max, airflow_raw, "
    "pressure_min, pressure_max, pressure_raw, "
    "power, noise_level, price, "
    "raw_diameter, raw_efficiency, raw_pressure, raw_power, raw_noise_level, raw_price, "
    "model_slug, nominal_rpm, pressure_coefficients, efficiency_coefficients, dimensions"
)


def _products_filter_sql(
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
) -> Tuple[str, List[Any], str]:
    """Фрагмент WHERE, параметры и ORDER BY для списка и COUNT."""
    conditions = ["1=1"]
    params: List[Any] = []
    n = 0

    def next_param(value: Any) -> str:
        nonlocal n
        n += 1
        params.append(value)
        return "%s"

    if q and q.strip():
        conditions.append("(LOWER(model) LIKE %s OR LOWER(size) LIKE %s OR LOWER(type) LIKE %s)")
        t = f"%{q.strip().lower()}%"
        params.extend([t, t, t])
    if type_:
        conditions.append("type = " + next_param(type_))
    if series:
        conditions.append("size = " + next_param(series))
    if diameter is not None:
        conditions.append("diameter = " + next_param(diameter))
    if min_price is not None:
        conditions.append("price IS NOT NULL AND price >= " + next_param(min_price))
    if max_price is not None:
        conditions.append("price IS NOT NULL AND price <= " + next_param(max_price))
    if min_power is not None:
        conditions.append("power IS NOT NULL AND power >= " + next_param(min_power))
    if max_power is not None:
        conditions.append("power IS NOT NULL AND power <= " + next_param(max_power))
    if min_noise is not None:
        conditions.append("noise_level IS NOT NULL AND noise_level >= " + next_param(min_noise))
    if max_noise is not None:
        conditions.append("noise_level IS NOT NULL AND noise_level <= " + next_param(max_noise))
    if min_diameter is not None:
        conditions.append("diameter IS NOT NULL AND diameter >= " + next_param(min_diameter))
    if max_diameter is not None:
        conditions.append("diameter IS NOT NULL AND diameter <= " + next_param(max_diameter))
    if min_airflow is not None:
        conditions.append("(airflow_max IS NULL OR airflow_max >= " + next_param(min_airflow) + ")")
    if max_airflow is not None:
        conditions.append("(airflow_min IS NULL OR airflow_min <= " + next_param(max_airflow) + ")")
    if min_pressure is not None:
        conditions.append("(pressure_max IS NULL OR pressure_max >= " + next_param(min_pressure) + ")")
    if max_pressure is not None:
        conditions.append("(pressure_min IS NULL OR pressure_min <= " + next_param(max_pressure) + ")")

    strategy = _get_sort_strategy(sort)
    order = strategy.order_by_sql()
    where_sql = " AND ".join(conditions)
    return where_sql, params, order


# ---------------------------------------------------------------------------
# PostgreSQL implementation
# ---------------------------------------------------------------------------

class PgProductRepository(AbstractProductRepository):
    """Реализация репозитория вентиляторов поверх PostgreSQL-соединения."""

    def __init__(self, conn) -> None:
        self._conn = conn

    def list_products(
        self,
        *,
        q=None, type_=None, series=None, diameter=None,
        min_price=None, max_price=None, min_power=None, max_power=None,
        min_noise=None, max_noise=None, min_diameter=None, max_diameter=None,
        min_airflow=None, max_airflow=None, min_pressure=None, max_pressure=None,
        sort="price_asc", limit=None, offset=0,
    ) -> List[Dict[str, Any]]:
        where_sql, params, order = _products_filter_sql(
            q=q, type_=type_, series=series, diameter=diameter,
            min_price=min_price, max_price=max_price,
            min_power=min_power, max_power=max_power,
            min_noise=min_noise, max_noise=max_noise,
            min_diameter=min_diameter, max_diameter=max_diameter,
            min_airflow=min_airflow, max_airflow=max_airflow,
            min_pressure=min_pressure, max_pressure=max_pressure,
            sort=sort,
        )
        sql = f"SELECT {_SELECT_COLS} FROM products WHERE {where_sql} ORDER BY {order}"
        q_params = list(params)
        if limit is not None:
            sql += " LIMIT %s OFFSET %s"
            q_params.extend([limit, offset])
        with self._conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, q_params)
            rows = cur.fetchall()
        return [_row_to_product_dict(dict(r)) for r in rows]

    def count_products_filtered(
        self,
        *,
        q=None, type_=None, series=None, diameter=None,
        min_price=None, max_price=None, min_power=None, max_power=None,
        min_noise=None, max_noise=None, min_diameter=None, max_diameter=None,
        min_airflow=None, max_airflow=None, min_pressure=None, max_pressure=None,
        sort="price_asc",
    ) -> int:
        where_sql, params, _ = _products_filter_sql(
            q=q, type_=type_, series=series, diameter=diameter,
            min_price=min_price, max_price=max_price,
            min_power=min_power, max_power=max_power,
            min_noise=min_noise, max_noise=max_noise,
            min_diameter=min_diameter, max_diameter=max_diameter,
            min_airflow=min_airflow, max_airflow=max_airflow,
            min_pressure=min_pressure, max_pressure=max_pressure,
            sort=sort,
        )
        with self._conn.cursor() as cur:
            cur.execute(f"SELECT COUNT(*) FROM products WHERE {where_sql}", params)
            return int(cur.fetchone()[0])

    def get_by_id(self, id_value: str) -> Optional[Dict[str, Any]]:
        with self._conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                f"SELECT {_SELECT_COLS} FROM products WHERE id = %s",
                (id_value.strip(),),
            )
            row = cur.fetchone()
        return _row_to_product_dict(dict(row)) if row else None

    def get_by_model_or_slug(self, model_value: str, slug_value: str) -> Optional[Dict[str, Any]]:
        with self._conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                f"SELECT {_SELECT_COLS} FROM products "
                "WHERE LOWER(model) = %s OR model_slug = %s LIMIT 1",
                (model_value.lower(), slug_value),
            )
            row = cur.fetchone()
        return _row_to_product_dict(dict(row)) if row else None

    def count_products(self) -> int:
        with self._conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM products")
            return int(cur.fetchone()[0])

    def list_distinct_types(self) -> List[str]:
        with self._conn.cursor() as cur:
            cur.execute(
                "SELECT DISTINCT type FROM products "
                "WHERE type IS NOT NULL AND TRIM(type) <> '' ORDER BY type"
            )
            return [r[0] for r in cur.fetchall()]

    def list_distinct_diameters(self) -> List[float]:
        with self._conn.cursor() as cur:
            cur.execute(
                "SELECT DISTINCT diameter FROM products "
                "WHERE diameter IS NOT NULL ORDER BY diameter"
            )
            return [float(r[0]) for r in cur.fetchall()]

    def fetch_all(self) -> List[Dict[str, Any]]:
        sql = f"SELECT {_SELECT_COLS} FROM products"
        with self._conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql)
            rows = cur.fetchall()
        return [_row_to_product_dict(dict(r)) for r in rows]


# ---------------------------------------------------------------------------
# Module-level functions (backward compat + standalone use)
# ---------------------------------------------------------------------------

def list_products(conn, **kwargs) -> List[Dict[str, Any]]:
    return PgProductRepository(conn).list_products(**kwargs)


def count_products_filtered(conn, **kwargs) -> int:
    return PgProductRepository(conn).count_products_filtered(**kwargs)


def get_by_id(conn, id_value: str) -> Optional[Dict[str, Any]]:
    return PgProductRepository(conn).get_by_id(id_value)


def get_by_model_or_slug(conn, model_value: str, slug_value: str) -> Optional[Dict[str, Any]]:
    return PgProductRepository(conn).get_by_model_or_slug(model_value, slug_value)


def count_products(conn) -> int:
    return PgProductRepository(conn).count_products()


def list_distinct_types(conn) -> List[str]:
    return PgProductRepository(conn).list_distinct_types()


def list_distinct_diameters(conn) -> List[float]:
    return PgProductRepository(conn).list_distinct_diameters()


def fetch_all_products_dicts(conn) -> List[Dict[str, Any]]:
    return PgProductRepository(conn).fetch_all()
