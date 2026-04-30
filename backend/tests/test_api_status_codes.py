from contextlib import contextmanager

from fastapi.testclient import TestClient

import app as app_module


def _make_client(monkeypatch: object) -> TestClient:
    # Isolate API tests from real DB lifecycle.
    monkeypatch.setattr(app_module, "_startup_db", lambda: None)
    monkeypatch.setattr(app_module, "shutdown_database", lambda: None)
    monkeypatch.setattr(app_module, "_ensure_catalog_sync_with_reindex", lambda: None)
    monkeypatch.setattr(app_module, "set_catalog_index", lambda _: None)

    @contextmanager
    def _fake_db_session():
        yield object()

    monkeypatch.setattr(app_module, "db_session", _fake_db_session)
    return TestClient(app_module.app, raise_server_exceptions=False)


def test_api_products_returns_200_for_valid_search(monkeypatch):
    monkeypatch.setattr(app_module, "count_products_filtered", lambda *args, **kwargs: 1)
    monkeypatch.setattr(
        app_module,
        "list_products",
        lambda *args, **kwargs: [
            {
                "id": "1",
                "number": "1",
                "type": "ВЦ",
                "model": "ВЦ 30-160-016-5",
                "size": "ВЦ 30-160-016",
                "diameter": 160.0,
                "airflow": {"min": 130.0, "max": 4140.0, "raw": "130 - 4140"},
                "pressure": {"min": 144.0, "max": 821.0, "raw": "144 - 821"},
                "power": 180.0,
                "noise_level": 74.0,
                "price": 28900.0,
                "_raw": {},
                "_meta": {"model_slug": "вц-30-160-016-5"},
            }
        ],
    )

    client = _make_client(monkeypatch)
    response = client.get("/api/products?limit=1&offset=0")

    assert response.status_code == 200
    body = response.json()
    assert "items" in body
    assert body["total"] == 1


def test_api_product_returns_404_when_model_not_found(monkeypatch):
    monkeypatch.setattr(app_module, "get_by_id", lambda *args, **kwargs: None)
    monkeypatch.setattr(app_module, "get_by_model_or_slug", lambda *args, **kwargs: None)

    client = _make_client(monkeypatch)
    response = client.get("/api/products/non-existent-model")

    assert response.status_code == 404
    assert "detail" in response.json()


def test_api_products_returns_422_for_invalid_params(monkeypatch):
    client = _make_client(monkeypatch)
    response = client.get("/api/products?limit=0&offset=0")

    assert response.status_code == 422


def test_api_returns_500_on_unhandled_server_error(monkeypatch):
    monkeypatch.setattr(app_module, "count_products_filtered", lambda *args, **kwargs: 1)

    def _boom(*args, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(app_module, "list_products", _boom)

    client = _make_client(monkeypatch)
    response = client.get("/api/products?limit=1&offset=0")

    assert response.status_code == 500
    assert response.json().get("error") == "Internal server error"

