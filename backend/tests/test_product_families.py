"""Тесты группировки вентиляторов в модельные ряды (families)."""
from __future__ import annotations

from application.use_cases.list_product_families import family_key
from infrastructure.db.product_repository import PgProductRepository
from tests.conftest import make_test_client


def _vo(pid: str, model: str, size: str, diameter: float):
    return {
        "id": pid, "number": pid, "type": "Осевой", "model": model, "size": size,
        "diameter": diameter,
        "airflow": {"min": 900, "max": 3600, "raw": "900 - 3600"},
        "pressure": {"min": 30, "max": 170, "raw": "30 - 170"},
        "power": 120, "noise_level": None, "price": 1000,
        "nominal_rpm": 1370.0,
        "_raw": {}, "_meta": {},
    }


def test_family_key_strips_trailing_size():
    assert family_key("ВО 13-284-4/15°-456A4", "456A4") == "ВО 13-284-4/15°"
    assert family_key("ВО 13-284-4/15°-456A4", "") == "ВО 13-284-4/15°-456A4"
    assert family_key("", "456A4") == ""
    assert family_key(None, None) == ""


def test_family_key_no_match_returns_full_model():
    # Типоразмер не совпадает с хвостом модели — ключ не режем
    assert family_key("ВО 13-284-4/15°-456A4", "999Z9") == "ВО 13-284-4/15°-456A4"


def test_api_products_families_groups_by_scheme(monkeypatch):
    small = _vo("small", "ВО 13-284-4/15°-456A4", "456A4", 405)
    big = _vo("big", "ВО 13-284-4/15°-880A6", "880A6", 720)
    other = _vo("other", "ВО 13-284-6/25°-456A4", "456A4", 405)

    monkeypatch.setattr(PgProductRepository, "fetch_all", lambda self: [small, big, other])
    client = make_test_client(monkeypatch)

    r = client.get("/api/products/families")
    assert r.status_code == 200
    data = r.json()
    families = {f["key"]: f for f in data["families"]}
    assert set(families.keys()) == {"ВО 13-284-4/15°", "ВО 13-284-6/25°"}

    fam = families["ВО 13-284-4/15°"]
    assert len(fam["variants"]) == 2
    # Отсортированы по диаметру
    assert [v["id"] for v in fam["variants"]] == ["small", "big"]

    assert len(families["ВО 13-284-6/25°"]["variants"]) == 1
