"""Тесты диагностики (/api/admin/debug) и лимита попыток входа."""
from __future__ import annotations

import pytest

from infrastructure.auth.jwt_service import create_access_token
from infrastructure.auth.rate_limit import LoginRateLimiter
from tests.conftest import make_test_client


def _fake_user_row(role: str) -> dict:
    return {
        "id": 1,
        "email": "test@ventsearch.local",
        "password_hash": "x",
        "name": "Test",
        "company": "",
        "phone": "",
        "role": role,
        "is_active": True,
        "created_at": None,
        "updated_at": None,
    }


def _auth_headers(role: str) -> dict:
    token = create_access_token(1, "test@ventsearch.local", role)
    return {"Authorization": f"Bearer {token}"}


def test_debug_requires_auth(monkeypatch):
    client = make_test_client(monkeypatch)
    assert client.get("/api/admin/debug").status_code == 401


def test_debug_forbidden_for_regular_user(monkeypatch):
    monkeypatch.setattr(
        "presentation.api.deps.get_user_by_id", lambda conn, uid: _fake_user_row("user")
    )
    client = make_test_client(monkeypatch)
    r = client.get("/api/admin/debug", headers=_auth_headers("user"))
    assert r.status_code == 403


def test_debug_returns_report_for_admin(monkeypatch):
    monkeypatch.setattr(
        "presentation.api.deps.get_user_by_id", lambda conn, uid: _fake_user_row("admin")
    )
    client = make_test_client(monkeypatch)
    r = client.get("/api/admin/debug", headers=_auth_headers("admin"))
    assert r.status_code == 200
    report = r.json()

    # Все секции присутствуют, даже если какая-то собралась с ошибкой
    for section in ("server", "database", "catalog", "search_index", "security"):
        assert section in report

    sec = report["security"]
    assert "jwt_secret_is_default" in sec
    assert "admin_password_is_default" in sec
    # Секретов в ответе быть не должно — только флаги
    assert "admin123" not in r.text
    assert "change-me-in-production" not in r.text


def test_login_rate_limiter_blocks_after_max_attempts():
    limiter = LoginRateLimiter(max_attempts=3, window_seconds=60)
    key = "1.2.3.4|user@test.local"

    assert limiter.seconds_until_allowed(key) == 0
    for _ in range(3):
        limiter.register_failure(key)
    assert limiter.seconds_until_allowed(key) > 0

    # Успешный вход сбрасывает счётчик
    limiter.reset(key)
    assert limiter.seconds_until_allowed(key) == 0


def test_login_endpoint_returns_429_after_failures(monkeypatch):
    import presentation.api.routes.auth as auth_mod

    monkeypatch.setattr(auth_mod, "get_user_by_email", lambda conn, email: None)
    auth_mod.login_limiter.clear()

    client = make_test_client(monkeypatch)
    body = {"email": "bruteforce@test.local", "password": "wrong-pass"}

    for _ in range(auth_mod.login_limiter.max_attempts):
        assert client.post("/api/auth/login", json=body).status_code == 401

    r = client.post("/api/auth/login", json=body)
    assert r.status_code == 429
    assert "Retry-After" in r.headers

    auth_mod.login_limiter.clear()
