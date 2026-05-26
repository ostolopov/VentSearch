import pytest
from fastapi.testclient import TestClient

from app import app
import app as app_module

def _make_client(monkeypatch):
    return TestClient(app)

def test_qp_endpoint_returns_bezier_curve(monkeypatch):
    sample = {
        "id": "1", "number": "1", "type": "ВО", "model": "ВО 30-160-040-1",
        "size": "ВО 30-160-040", "diameter": 400.0,
        "airflow": {"min": 900, "max": 3600, "raw": "900 - 3600"},
        "pressure": {"min": 30, "max": 170, "raw": "30 - 170"},
        "power": 180, "noise_level": 82, "price": 18500,
        "_raw": {}, "_meta": {},
    }
    
    # Mocking database access
    monkeypatch.setattr(app_module, "get_by_id", lambda *a, **kw: sample)
    monkeypatch.setattr(app_module, "get_by_model_or_slug", lambda *a, **kw: None)
    
    # Needs to mock _ensure_catalog_sync_with_reindex so it doesn't touch real DB in unit tests
    monkeypatch.setattr(app_module, "_ensure_catalog_sync_with_reindex", lambda *a, **kw: None)
    
    # We also need to mock db_session to avoid connection errors if we're entirely isolated
    from contextlib import contextmanager
    @contextmanager
    def mock_db_session():
        yield None
    monkeypatch.setattr(app_module, "db_session", mock_db_session)
    
    client = _make_client(monkeypatch)
    r = client.get("/api/products/1/qp?points=25")
    assert r.status_code == 200
    pts = r.json()
    assert len(pts) == 25
    
    # начало — на A
    assert pts[0]["q"] == pytest.approx(900, rel=1e-3)
    assert pts[0]["p"] == pytest.approx(170, rel=1e-3)
    
    # конец — на C
    assert pts[-1]["q"] == pytest.approx(3600, rel=1e-3)
    assert pts[-1]["p"] == pytest.approx(30, rel=1e-3)
    
    # для осевого ВО с α=0.18: точка в середине должна быть ВЫШЕ
    # чем парабола через те же концы (т.е. выше середины P)
    mid_p = pts[12]["p"]
    assert mid_p > 100 # ((170+30)/2 = 100), Безье с положительным α даёт горб

def test_qp_endpoint_polynomial_and_affinity(monkeypatch):
    # Коэффициенты P(Q) = 450 + 0.02*Q - 1e-5*Q^2
    # Q_min = 2000, Q_max = 8000
    sample = {
        "id": "2", "number": "2", "type": "ВР", "model": "ВР 80-75-5",
        "size": "5", "diameter": 500.0,
        "airflow": {"min": 2000, "max": 8000, "raw": "2000-8000"},
        "pressure": {"min": 0, "max": 0, "raw": "0-0"}, # Будут переопределены полиномом, но API требует наличия ключей
        "power": 180, "noise_level": 82, "price": 18500,
        "nominal_rpm": 1450,
        "pressure_coefficients": [450, 0.02, -1e-5],
        "_raw": {}, "_meta": {},
    }
    
    # Mocking database access
    monkeypatch.setattr(app_module, "get_by_id", lambda *a, **kw: sample)
    monkeypatch.setattr(app_module, "get_by_model_or_slug", lambda *a, **kw: None)
    
    monkeypatch.setattr(app_module, "_ensure_catalog_sync_with_reindex", lambda *a, **kw: None)
    
    from contextlib import contextmanager
    @contextmanager
    def mock_db_session():
        yield None
    monkeypatch.setattr(app_module, "db_session", mock_db_session)
    
    client = _make_client(monkeypatch)
    
    # Тест 1: Без target_rpm
    r = client.get("/api/products/2/qp?points=3")
    assert r.status_code == 200
    pts = r.json()
    assert len(pts) == 3
    
    # Точка 1: Q = 2000
    # P = 450 + 0.02*2000 - 1e-5*(2000^2) = 450 + 40 - 40 = 450
    assert pts[0]["q"] == pytest.approx(2000, rel=1e-3)
    assert pts[0]["p"] == pytest.approx(450, rel=1e-3)
    
    # Точка 3: Q = 8000
    # P = 450 + 0.02*8000 - 1e-5*(8000^2) = 450 + 160 - 640 = -30
    assert pts[-1]["q"] == pytest.approx(8000, rel=1e-3)
    assert pts[-1]["p"] == pytest.approx(-30, rel=1e-3)
    
    # Тест 2: С target_rpm (увеличение оборотов)
    # По закону подобия, при rpm_2 = 2900 (в 2 раза больше):
    # Q_2 = Q_1 * 2, P_2 = P_1 * 4
    r2 = client.get("/api/products/2/qp?points=3&target_rpm=2900")
    assert r2.status_code == 200
    pts2 = r2.json()
    assert len(pts2) == 3
    
    # Точка 1: Q = 2000 * 2 = 4000
    # P = 450 * 4 = 1800
    assert pts2[0]["q"] == pytest.approx(4000, rel=1e-3)
    assert pts2[0]["p"] == pytest.approx(1800, rel=1e-3)
    
    # Точка 3: Q = 8000 * 2 = 16000
    # P = -30 * 4 = -120
    assert pts2[-1]["q"] == pytest.approx(16000, rel=1e-3)
    assert pts2[-1]["p"] == pytest.approx(-120, rel=1e-3)
