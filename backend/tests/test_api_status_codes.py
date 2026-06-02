from infrastructure.db.product_repository import PgProductRepository
from tests.conftest import make_test_client


def test_api_products_returns_200_for_valid_search(monkeypatch):
    monkeypatch.setattr(PgProductRepository, "count_products_filtered", lambda self, **kwargs: 1)
    monkeypatch.setattr(
        PgProductRepository,
        "list_products",
        lambda self, **kwargs: [
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

    client = make_test_client(monkeypatch)
    response = client.get("/api/products?limit=1&offset=0")

    assert response.status_code == 200
    body = response.json()
    assert "items" in body
    assert body["total"] == 1


def test_api_product_returns_404_when_model_not_found(monkeypatch):
    monkeypatch.setattr(PgProductRepository, "get_by_id", lambda self, id_value: None)
    monkeypatch.setattr(PgProductRepository, "get_by_model_or_slug", lambda self, m, s: None)

    client = make_test_client(monkeypatch)
    response = client.get("/api/products/non-existent-model")

    assert response.status_code == 404
    assert "detail" in response.json()


def test_api_products_returns_422_for_invalid_params(monkeypatch):
    client = make_test_client(monkeypatch)
    response = client.get("/api/products?limit=0&offset=0")

    assert response.status_code == 422


def test_api_returns_500_on_unhandled_server_error(monkeypatch):
    monkeypatch.setattr(PgProductRepository, "count_products_filtered", lambda self, **kwargs: 1)

    def _boom(self, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(PgProductRepository, "list_products", _boom)

    client = make_test_client(monkeypatch, raise_server_exceptions=False)
    response = client.get("/api/products?limit=1&offset=0")

    assert response.status_code == 500
    assert response.json().get("error") == "Internal server error"
