import pytest
from fastapi.testclient import TestClient

from infrastructure.db.product_repository import PgProductRepository
from tests.conftest import make_test_client


def test_qp_endpoint_returns_bezier_curve(monkeypatch):
    sample = {
        "id": "1", "number": "1", "type": "ВО", "model": "ВО 30-160-040-1",
        "size": "ВО 30-160-040", "diameter": 400.0,
        "airflow": {"min": 900, "max": 3600, "raw": "900 - 3600"},
        "pressure": {"min": 30, "max": 170, "raw": "30 - 170"},
        "power": 180, "noise_level": 82, "price": 18500,
        "_raw": {}, "_meta": {},
    }

    monkeypatch.setattr(PgProductRepository, "get_by_id", lambda self, id_value: sample)
    monkeypatch.setattr(PgProductRepository, "get_by_model_or_slug", lambda self, m, s: None)

    client = make_test_client(monkeypatch)
    r = client.get("/api/products/1/qp?points=25")
    assert r.status_code == 200
    pts = r.json()
    assert len(pts) == 25

    assert pts[0]["q"] == pytest.approx(900, rel=1e-3)
    assert pts[0]["p"] == pytest.approx(170, rel=1e-3)
    assert pts[-1]["q"] == pytest.approx(3600, rel=1e-3)
    assert pts[-1]["p"] == pytest.approx(30, rel=1e-3)

    mid_p = pts[12]["p"]
    assert mid_p > 100


def test_qp_endpoint_polynomial_and_affinity(monkeypatch):
    sample = {
        "id": "2", "number": "2", "type": "ВР", "model": "ВР 80-75-5",
        "size": "5", "diameter": 500.0,
        "airflow": {"min": 2000, "max": 8000, "raw": "2000-8000"},
        "pressure": {"min": 0, "max": 0, "raw": "0-0"},
        "power": 180, "noise_level": 82, "price": 18500,
        "nominal_rpm": 1450,
        "pressure_coefficients": [450, 0.02, -1e-5],
        "_raw": {}, "_meta": {},
    }

    monkeypatch.setattr(PgProductRepository, "get_by_id", lambda self, id_value: sample)
    monkeypatch.setattr(PgProductRepository, "get_by_model_or_slug", lambda self, m, s: None)

    client = make_test_client(monkeypatch)

    r = client.get("/api/products/2/qp?points=3")
    assert r.status_code == 200
    pts = r.json()
    assert len(pts) == 3

    assert pts[0]["q"] == pytest.approx(2000, rel=1e-3)
    assert pts[0]["p"] == pytest.approx(450, rel=1e-3)
    assert pts[-1]["q"] == pytest.approx(8000, rel=1e-3)
    assert pts[-1]["p"] == pytest.approx(-30, rel=1e-3)

    r2 = client.get("/api/products/2/qp?points=3&target_rpm=2900")
    assert r2.status_code == 200
    pts2 = r2.json()
    assert len(pts2) == 3

    assert pts2[0]["q"] == pytest.approx(4000, rel=1e-3)
    assert pts2[0]["p"] == pytest.approx(1800, rel=1e-3)
    assert pts2[-1]["q"] == pytest.approx(16000, rel=1e-3)
    assert pts2[-1]["p"] == pytest.approx(-120, rel=1e-3)
