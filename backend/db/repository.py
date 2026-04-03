"""
Репозиторий продуктов: выборка списка с фильтрами и по id/модели/slug.
"""
from typing import Any, Dict, List, Optional

import psycopg2
from psycopg2.extras import RealDictCursor


def _row_to_product_dict(row: Dict[str, Any]) -> Dict[str, Any]:
    """Преобразует строку БД в структуру, совместимую с product_to_json (Product)."""
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


def list_products(
    conn,
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
) -> List[Dict[str, Any]]:
    """
    Выборка товаров с фильтрами. Сортировка по цене (price_asc / price_desc),
    товары без цены в конце.
    """
    conditions = ["1=1"]
    params: List[Any] = []
    n = 0

    def next_param(value: Any) -> str:
        nonlocal n
        n += 1
        params.append(value)
        return f"%s"

    if q and q.strip():
        conditions.append(
            "(LOWER(model) LIKE %s OR LOWER(size) LIKE %s OR LOWER(type) LIKE %s)"
        )
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
        conditions.append(
            "noise_level IS NOT NULL AND noise_level >= " + next_param(min_noise)
        )
    if max_noise is not None:
        conditions.append(
            "noise_level IS NOT NULL AND noise_level <= " + next_param(max_noise)
        )
    if min_diameter is not None:
        conditions.append(
            "diameter IS NOT NULL AND diameter >= " + next_param(min_diameter)
        )
    if max_diameter is not None:
        conditions.append(
            "diameter IS NOT NULL AND diameter <= " + next_param(max_diameter)
        )
    if min_airflow is not None:
        conditions.append(
            "(airflow_max IS NULL OR airflow_max >= " + next_param(min_airflow) + ")"
        )
    if max_airflow is not None:
        conditions.append(
            "(airflow_min IS NULL OR airflow_min <= " + next_param(max_airflow) + ")"
        )
    if min_pressure is not None:
        conditions.append(
            "(pressure_max IS NULL OR pressure_max >= " + next_param(min_pressure) + ")"
        )
    if max_pressure is not None:
        conditions.append(
            "(pressure_min IS NULL OR pressure_min <= " + next_param(max_pressure) + ")"
        )

    order = "price ASC NULLS LAST, model ASC"
    if sort == "price_desc":
        order = "price DESC NULLS LAST, model ASC"

    sql_query = f"""
        SELECT id, number, type, model, size, diameter,
               airflow_min, airflow_max, airflow_raw,
               pressure_min, pressure_max, pressure_raw,
               power, noise_level, price,
               raw_diameter, raw_efficiency, raw_pressure, raw_power, raw_noise_level, raw_price,
               model_slug
        FROM products
        WHERE {" AND ".join(conditions)}
        ORDER BY {order}
    """
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(sql_query, params)
        rows = cur.fetchall()
    return [_row_to_product_dict(dict(r)) for r in rows]


def get_by_id(conn, id_value: str) -> Optional[Dict[str, Any]]:
    """Найти товар по id (number)."""
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            "SELECT id, number, type, model, size, diameter, "
            "airflow_min, airflow_max, airflow_raw, pressure_min, pressure_max, pressure_raw, "
            "power, noise_level, price, "
            "raw_diameter, raw_efficiency, raw_pressure, raw_power, raw_noise_level, raw_price, "
            "model_slug FROM products WHERE id = %s",
            (id_value.strip(),),
        )
        row = cur.fetchone()
    if not row:
        return None
    return _row_to_product_dict(dict(row))


def get_by_model_or_slug(
    conn, model_value: str, slug_value: str
) -> Optional[Dict[str, Any]]:
    """Найти товар по точному совпадению model (case-insensitive) или model_slug."""
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            "SELECT id, number, type, model, size, diameter, "
            "airflow_min, airflow_max, airflow_raw, pressure_min, pressure_max, pressure_raw, "
            "power, noise_level, price, "
            "raw_diameter, raw_efficiency, raw_pressure, raw_power, raw_noise_level, raw_price, "
            "model_slug FROM products WHERE LOWER(model) = %s OR model_slug = %s LIMIT 1",
            (model_value.lower(), slug_value),
        )
        row = cur.fetchone()
    if not row:
        return None
    return _row_to_product_dict(dict(row))


def count_products(conn) -> int:
    """Общее количество товаров в БД."""
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM products")
        return cur.fetchone()[0]


def fetch_all_products_dicts(conn) -> List[Dict[str, Any]]:
    """Все товары для in-memory индекса (Bloom + отсортированные оси)."""
    sql = """
        SELECT id, number, type, model, size, diameter,
               airflow_min, airflow_max, airflow_raw,
               pressure_min, pressure_max, pressure_raw,
               power, noise_level, price,
               raw_diameter, raw_efficiency, raw_pressure, raw_power, raw_noise_level, raw_price,
               model_slug
        FROM products
    """
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(sql)
        rows = cur.fetchall()
    return [_row_to_product_dict(dict(r)) for r in rows]
