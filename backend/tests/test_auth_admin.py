"""Тесты auth и admin (без реальной БД)."""
from contextlib import contextmanager

from fastapi.testclient import TestClient

import app as app_module
from auth.security import hash_password, verify_password


def _make_client(monkeypatch):
    monkeypatch.setattr(app_module, "_startup_db", lambda: None)
    monkeypatch.setattr(app_module, "shutdown_database", lambda: None)
    monkeypatch.setattr(app_module, "_ensure_catalog_sync_with_reindex", lambda: None)
    monkeypatch.setattr(app_module, "set_catalog_index", lambda _: None)

    @contextmanager
    def _fake_db_session():
        yield object()

    monkeypatch.setattr("api.deps.db_session", _fake_db_session)
    monkeypatch.setattr("api.auth_routes.db_session", _fake_db_session)
    monkeypatch.setattr("api.admin_routes.db_session", _fake_db_session)
    return TestClient(app_module.app, raise_server_exceptions=False)


def test_password_hash_roundtrip():
    hashed = hash_password("secret123")
    assert verify_password("secret123", hashed)
    assert not verify_password("wrong", hashed)


def test_login_requires_user(monkeypatch):
    monkeypatch.setattr("api.auth_routes.get_user_by_email", lambda *args, **kwargs: None)
    client = _make_client(monkeypatch)
    response = client.post(
        "/api/auth/login",
        json={"email": "nobody@test.local", "password": "secret123"},
    )
    assert response.status_code == 401


def test_admin_products_requires_auth(monkeypatch):
    client = _make_client(monkeypatch)
    response = client.get("/api/admin/products")
    assert response.status_code == 401
