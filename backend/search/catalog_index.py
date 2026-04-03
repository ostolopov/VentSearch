"""
Двухэтапный поиск по каталогу:
1) Bloom filter по категориальным полям (тип, типоразмер / «серия»);
2) Пересечение множеств id по отсортированным числовым индексам (bisect);
3) Точная фильтрация по q, пересечению диапазонов расхода/давления и сортировка.
"""
from __future__ import annotations

import logging
from collections import defaultdict
from typing import Dict, List, Optional, Set

from db.repository import fetch_all_products_dicts
from search.bloom_filter import BloomFilter
from search.numeric_index import SortedRangeIndex

logger = logging.getLogger(__name__)

_catalog_index: Optional["CatalogIndex"] = None


def get_catalog_index() -> Optional["CatalogIndex"]:
    return _catalog_index


def set_catalog_index(idx: Optional["CatalogIndex"]) -> None:
    global _catalog_index
    _catalog_index = idx


def _airflow_ok(
    r: dict,
    min_airflow: Optional[float],
    max_airflow: Optional[float],
) -> bool:
    af = r["airflow"]
    if min_airflow is not None:
        amax = af.get("max")
        if amax is not None and amax < min_airflow:
            return False
    if max_airflow is not None:
        amin = af.get("min")
        if amin is not None and amin > max_airflow:
            return False
    return True


def _pressure_ok(
    r: dict,
    min_p: Optional[float],
    max_p: Optional[float],
) -> bool:
    pr = r["pressure"]
    if min_p is not None:
        pmax = pr.get("max")
        if pmax is not None and pmax < min_p:
            return False
    if max_p is not None:
        pmin = pr.get("min")
        if pmin is not None and pmin > max_p:
            return False
    return True


class CatalogIndex:
    __slots__ = (
        "_rows",
        "_by_id",
        "_type_bloom",
        "_size_bloom",
        "_type_to_ids",
        "_size_to_ids",
        "_idx_price",
        "_idx_power",
        "_idx_noise",
        "_idx_diameter",
    )

    def __init__(
        self,
        rows: List[dict],
        type_bloom: BloomFilter,
        size_bloom: BloomFilter,
        type_to_ids: Dict[str, Set[str]],
        size_to_ids: Dict[str, Set[str]],
        idx_price: SortedRangeIndex,
        idx_power: SortedRangeIndex,
        idx_noise: SortedRangeIndex,
        idx_diameter: SortedRangeIndex,
    ) -> None:
        self._rows = rows
        self._by_id = {r["id"]: r for r in rows}
        self._type_bloom = type_bloom
        self._size_bloom = size_bloom
        self._type_to_ids = type_to_ids
        self._size_to_ids = size_to_ids
        self._idx_price = idx_price
        self._idx_power = idx_power
        self._idx_noise = idx_noise
        self._idx_diameter = idx_diameter

    @classmethod
    def build(cls, conn) -> CatalogIndex:
        rows = fetch_all_products_dicts(conn)
        distinct_types = {r["type"] for r in rows if r.get("type")}
        distinct_sizes = {r["size"] for r in rows if r.get("size")}
        n_types = max(1, len(distinct_types))
        n_sizes = max(1, len(distinct_sizes))

        type_bloom = BloomFilter(expected_items=n_types * 2, false_positive_rate=0.01)
        type_bloom.add_many(distinct_types)
        size_bloom = BloomFilter(expected_items=n_sizes * 2, false_positive_rate=0.01)
        size_bloom.add_many(distinct_sizes)

        type_to_ids: Dict[str, Set[str]] = defaultdict(set)
        size_to_ids: Dict[str, Set[str]] = defaultdict(set)
        for r in rows:
            if r.get("type"):
                type_to_ids[r["type"]].add(r["id"])
            if r.get("size"):
                size_to_ids[r["size"]].add(r["id"])

        def pairs(getter) -> List[tuple]:
            out: List[tuple] = []
            for r in rows:
                v = getter(r)
                if v is not None:
                    out.append((float(v), r["id"]))
            return out

        idx_price = SortedRangeIndex(pairs(lambda r: r["price"]))
        idx_power = SortedRangeIndex(pairs(lambda r: r["power"]))
        idx_noise = SortedRangeIndex(pairs(lambda r: r["noise_level"]))
        idx_diameter = SortedRangeIndex(pairs(lambda r: r["diameter"]))

        logger.info(
            "Поисковый индекс: %s записей, Bloom(type) ~%s значений, Bloom(size) ~%s",
            len(rows),
            len(distinct_types),
            len(distinct_sizes),
        )
        return cls(
            rows,
            type_bloom,
            size_bloom,
            type_to_ids,
            size_to_ids,
            idx_price,
            idx_power,
            idx_noise,
            idx_diameter,
        )

    @staticmethod
    def _intersect(cur: Optional[Set[str]], nxt: Set[str]) -> Set[str]:
        if cur is None:
            return set(nxt)
        return cur & nxt

    def search(
        self,
        *,
        q: Optional[str],
        type_: Optional[str],
        series: Optional[str],
        diameter: Optional[float],
        min_price: Optional[float],
        max_price: Optional[float],
        min_power: Optional[float],
        max_power: Optional[float],
        min_noise: Optional[float],
        max_noise: Optional[float],
        min_diameter: Optional[float],
        max_diameter: Optional[float],
        min_airflow: Optional[float],
        max_airflow: Optional[float],
        min_pressure: Optional[float],
        max_pressure: Optional[float],
        sort: str,
    ) -> List[dict]:
        if not self._rows:
            return []

        # --- Этап 1: категориальные признаки через Bloom + точное множество по типу ---
        if type_:
            if not self._type_bloom.might_contain(type_):
                return []
            cur: Optional[Set[str]] = set(self._type_to_ids.get(type_, set()))
            if not cur:
                return []
        else:
            cur = None

        if series:
            if not self._size_bloom.might_contain(series):
                return []
            cur = self._intersect(cur, set(self._size_to_ids.get(series, set())))
            if not cur:
                return []

        # --- Этап 2: числовые оси — отсортированные индексы (bisect) и пересечение ---
        if min_price is not None or max_price is not None:
            cur = self._intersect(cur, self._idx_price.ids_in_range(min_price, max_price))
            if not cur:
                return []

        if min_power is not None or max_power is not None:
            cur = self._intersect(cur, self._idx_power.ids_in_range(min_power, max_power))
            if not cur:
                return []

        if min_noise is not None or max_noise is not None:
            cur = self._intersect(cur, self._idx_noise.ids_in_range(min_noise, max_noise))
            if not cur:
                return []

        if min_diameter is not None or max_diameter is not None:
            cur = self._intersect(cur, self._idx_diameter.ids_in_range(min_diameter, max_diameter))
            if not cur:
                return []

        if diameter is not None:
            cur = self._intersect(cur, self._idx_diameter.ids_in_range(diameter, diameter))
            if not cur:
                return []

        # --- Этап 3: материализация и точные условия (q, диапазоны расхода/давления) ---
        if cur is None:
            candidates = list(self._rows)
        else:
            candidates = [self._by_id[i] for i in cur if i in self._by_id]

        out: List[dict] = []
        for r in candidates:
            if q:
                hay = f"{r.get('model', '')} {r.get('size', '')} {r.get('type', '')}".lower()
                if q not in hay:
                    continue
            if not _airflow_ok(r, min_airflow, max_airflow):
                continue
            if not _pressure_ok(r, min_pressure, max_pressure):
                continue
            out.append(r)

        if sort == "price_desc":
            out.sort(
                key=lambda r: (
                    r["price"] is None,
                    -(r["price"] or 0) if r["price"] is not None else 0,
                    r.get("model") or "",
                )
            )
        else:
            out.sort(
                key=lambda r: (
                    r["price"] is None,
                    r["price"] if r["price"] is not None else 0.0,
                    r.get("model") or "",
                )
            )
        return out
