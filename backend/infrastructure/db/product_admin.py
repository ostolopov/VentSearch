"""CRUD вентиляторов для админ-панели."""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

from psycopg2.extras import RealDictCursor

from infrastructure.db.product_repository import _row_to_product_dict, get_by_id


def _slugify(value: str) -> str:
    s = " ".join(str(value or "").replace("\u00a0", " ").split()).lower()
    s = re.sub(r"[^\w]+", "-", s, flags=re.UNICODE)
    return re.sub(r"-{2,}", "-", s).strip("-")


def _normalize_product_payload(data: Dict[str, Any]) -> Dict[str, Any]:
    product_id = str(data.get("id") or "").strip()
    if not product_id:
        raise ValueError("Product id is required")
    model = str(data.get("model") or "").strip()
    number = str(data.get("number") or product_id).strip()
    model_slug = str(data.get("model_slug") or "").strip() or _slugify(model)
    return {
        "id": product_id,
        "number": number,
        "type": str(data.get("type") or "").strip(),
        "model": model,
        "size": str(data.get("size") or "").strip(),
        "diameter": data.get("diameter"),
        "airflow_min": data.get("airflow_min"),
        "airflow_max": data.get("airflow_max"),
        "airflow_raw": str(data.get("airflow_raw") or "").strip(),
        "pressure_min": data.get("pressure_min"),
        "pressure_max": data.get("pressure_max"),
        "pressure_raw": str(data.get("pressure_raw") or "").strip(),
        "power": data.get("power"),
        "noise_level": data.get("noise_level"),
        "price": data.get("price"),
        "raw_diameter": str(data.get("raw_diameter") or "").strip(),
        "raw_efficiency": str(data.get("raw_efficiency") or "").strip(),
        "raw_pressure": str(data.get("raw_pressure") or "").strip(),
        "raw_power": str(data.get("raw_power") or "").strip(),
        "raw_noise_level": str(data.get("raw_noise_level") or "").strip(),
        "raw_price": str(data.get("raw_price") or "").strip(),
        "model_slug": model_slug,
    }


def admin_list_products(
    conn,
    *,
    q: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> Tuple[List[Dict[str, Any]], int]:
    conditions = ["1=1"]
    params: List[Any] = []
    if q and q.strip():
        t = f"%{q.strip().lower()}%"
        conditions.append(
            "(LOWER(id) LIKE %s OR LOWER(model) LIKE %s OR LOWER(type) LIKE %s OR LOWER(size) LIKE %s)"
        )
        params.extend([t, t, t, t])
    where_sql = " AND ".join(conditions)
    with conn.cursor() as cur:
        cur.execute(f"SELECT COUNT(*) FROM products WHERE {where_sql}", params)
        total = int(cur.fetchone()[0])
    sql = f"""
        SELECT id, number, type, model, size, diameter,
               airflow_min, airflow_max, airflow_raw,
               pressure_min, pressure_max, pressure_raw,
               power, noise_level, price,
               raw_diameter, raw_efficiency, raw_pressure, raw_power, raw_noise_level, raw_price,
               model_slug
        FROM products WHERE {where_sql}
        ORDER BY id ASC LIMIT %s OFFSET %s
    """
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(sql, [*params, limit, offset])
        rows = cur.fetchall()
    return [_row_to_product_dict(dict(r)) for r in rows], total


def create_product(conn, data: Dict[str, Any]) -> Dict[str, Any]:
    p = _normalize_product_payload(data)
    if get_by_id(conn, p["id"]):
        raise ValueError(f"Product with id {p['id']} already exists")
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO products (
                id, number, type, model, size, diameter,
                airflow_min, airflow_max, airflow_raw,
                pressure_min, pressure_max, pressure_raw,
                power, noise_level, price,
                raw_diameter, raw_efficiency, raw_pressure, raw_power, raw_noise_level, raw_price,
                model_slug
            ) VALUES (
                %(id)s, %(number)s, %(type)s, %(model)s, %(size)s, %(diameter)s,
                %(airflow_min)s, %(airflow_max)s, %(airflow_raw)s,
                %(pressure_min)s, %(pressure_max)s, %(pressure_raw)s,
                %(power)s, %(noise_level)s, %(price)s,
                %(raw_diameter)s, %(raw_efficiency)s, %(raw_pressure)s, %(raw_power)s,
                %(raw_noise_level)s, %(raw_price)s,
                %(model_slug)s
            )
            """,
            p,
        )
    conn.commit()
    product = get_by_id(conn, p["id"])
    if not product:
        raise ValueError("Failed to create product")
    return product


def update_product(conn, product_id: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not get_by_id(conn, product_id):
        return None
    p = _normalize_product_payload({**data, "id": product_id})
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE products SET
                number = %(number)s, type = %(type)s, model = %(model)s, size = %(size)s,
                diameter = %(diameter)s,
                airflow_min = %(airflow_min)s, airflow_max = %(airflow_max)s, airflow_raw = %(airflow_raw)s,
                pressure_min = %(pressure_min)s, pressure_max = %(pressure_max)s, pressure_raw = %(pressure_raw)s,
                power = %(power)s, noise_level = %(noise_level)s, price = %(price)s,
                raw_diameter = %(raw_diameter)s, raw_efficiency = %(raw_efficiency)s,
                raw_pressure = %(raw_pressure)s, raw_power = %(raw_power)s,
                raw_noise_level = %(raw_noise_level)s, raw_price = %(raw_price)s,
                model_slug = %(model_slug)s
            WHERE id = %(id)s
            """,
            p,
        )
    conn.commit()
    return get_by_id(conn, product_id)


def delete_product(conn, product_id: str) -> bool:
    with conn.cursor() as cur:
        cur.execute("DELETE FROM products WHERE id = %s", (product_id.strip(),))
        deleted = cur.rowcount > 0
    conn.commit()
    return deleted


def delete_products_bulk(conn, product_ids: List[str]) -> int:
    ids = list(dict.fromkeys(str(i).strip() for i in product_ids if str(i).strip()))
    if not ids:
        return 0
    with conn.cursor() as cur:
        cur.execute("DELETE FROM products WHERE id = ANY(%s)", (ids,))
        deleted = int(cur.rowcount)
    conn.commit()
    return deleted
