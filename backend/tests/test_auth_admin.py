"""Тесты auth и admin (без реальной БД)."""
from infrastructure.auth.jwt_service import hash_password, verify_password
from tests.conftest import make_test_client


def test_password_hash_roundtrip():
    hashed = hash_password("secret123")
    assert verify_password("secret123", hashed)
    assert not verify_password("wrong", hashed)


def test_login_requires_user(monkeypatch):
    monkeypatch.setattr("presentation.api.routes.auth.get_user_by_email", lambda conn, email: None)
    client = make_test_client(monkeypatch)
    response = client.post(
        "/api/auth/login",
        json={"email": "nobody@test.local", "password": "secret123"},
    )
    assert response.status_code == 401


def test_admin_products_requires_auth(monkeypatch):
    client = make_test_client(monkeypatch)
    response = client.get("/api/admin/products")
    assert response.status_code == 401
