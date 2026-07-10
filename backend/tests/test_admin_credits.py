"""Тесты /api/admin/credits — раздел «О команде» в глубине админ-панели."""
from __future__ import annotations

import json

from infrastructure.auth.jwt_service import create_access_token
from tests.conftest import make_test_client


def _fake_user_row(role: str) -> dict:
    return {
        "id": 1, "email": "test@ventsearch.local", "password_hash": "x", "name": "Test",
        "company": "", "phone": "", "role": role, "is_active": True,
        "created_at": None, "updated_at": None,
    }


def _auth_headers(role: str) -> dict:
    token = create_access_token(1, "test@ventsearch.local", role)
    return {"Authorization": f"Bearer {token}"}


def test_credits_requires_auth(monkeypatch):
    client = make_test_client(monkeypatch)
    assert client.get("/api/admin/credits").status_code == 401


def test_credits_forbidden_for_regular_user(monkeypatch):
    monkeypatch.setattr("presentation.api.deps.get_user_by_id", lambda conn, uid: _fake_user_row("user"))
    client = make_test_client(monkeypatch)
    r = client.get("/api/admin/credits", headers=_auth_headers("user"))
    assert r.status_code == 403


def test_credits_missing_file_reports_not_found(monkeypatch, tmp_path):
    monkeypatch.setattr("presentation.api.deps.get_user_by_id", lambda conn, uid: _fake_user_row("admin"))
    import config
    monkeypatch.setattr(config, "CREDITS_PATH", tmp_path / "does_not_exist.json")
    client = make_test_client(monkeypatch)
    r = client.get("/api/admin/credits", headers=_auth_headers("admin"))
    assert r.status_code == 200
    assert r.json()["found"] is False


def test_credits_reads_real_file(monkeypatch, tmp_path):
    monkeypatch.setattr("presentation.api.deps.get_user_by_id", lambda conn, uid: _fake_user_row("admin"))
    payload = {
        "_comment": "internal note, must not leak",
        "project_name": "VENTSEARCH",
        "tagline": "Test tagline",
        "updated": "2026-01-01",
        "creators": [{"name": "Иван Иванов", "role": "Backend", "contact": "ivan@example.com"}],
    }
    p = tmp_path / "credits.json"
    p.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    import config
    monkeypatch.setattr(config, "CREDITS_PATH", p)
    client = make_test_client(monkeypatch)
    r = client.get("/api/admin/credits", headers=_auth_headers("admin"))
    assert r.status_code == 200
    data = r.json()
    assert data["found"] is True
    assert data["project_name"] == "VENTSEARCH"
    assert data["creators"][0]["name"] == "Иван Иванов"
    assert "_comment" not in data


def test_credits_malformed_json_reports_error(monkeypatch, tmp_path):
    monkeypatch.setattr("presentation.api.deps.get_user_by_id", lambda conn, uid: _fake_user_row("admin"))
    p = tmp_path / "credits.json"
    p.write_text("{not valid json", encoding="utf-8")

    import config
    monkeypatch.setattr(config, "CREDITS_PATH", p)
    client = make_test_client(monkeypatch)
    r = client.get("/api/admin/credits", headers=_auth_headers("admin"))
    assert r.status_code == 200
    data = r.json()
    assert data["found"] is True
    assert "error" in data


# ---------------------------------------------------------------------------
# Публичный /api/contacts — выжимка для контакт-виджета (без авторизации)
# ---------------------------------------------------------------------------

def test_public_contacts_no_auth_required(monkeypatch, tmp_path):
    payload = {
        "project_name": "VENTSEARCH",
        "creators": [
            {"name": "Иван", "role": "Backend", "contact": "ivan@example.com",
             "note": "внутренняя заметка — наружу не отдаём"},
        ],
    }
    p = tmp_path / "credits.json"
    p.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    import config
    monkeypatch.setattr(config, "CREDITS_PATH", p)
    client = make_test_client(monkeypatch)

    r = client.get("/api/contacts")  # без токена
    assert r.status_code == 200
    data = r.json()
    assert data["found"] is True
    assert data["creators"][0]["name"] == "Иван"
    assert data["creators"][0]["contact"] == "ivan@example.com"
    # Приватные поля не утекают в публичный эндпоинт
    assert "note" not in data["creators"][0]
    assert "внутренняя" not in r.text


def test_public_contacts_missing_file(monkeypatch, tmp_path):
    import config
    monkeypatch.setattr(config, "CREDITS_PATH", tmp_path / "nope.json")
    client = make_test_client(monkeypatch)
    r = client.get("/api/contacts")
    assert r.status_code == 200
    assert r.json() == {"found": False, "creators": []}
