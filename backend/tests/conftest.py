"""Общие хелперы для API-тестов без реальной БД."""
from __future__ import annotations

from contextlib import contextmanager

from fastapi.testclient import TestClient

import presentation.app as pres_app
import presentation.api.routes.catalog as catalog_mod


@contextmanager
def fake_db_session():
    yield object()


def isolate_app(monkeypatch) -> None:
    """Отключить старт БД и синхронизацию CSV в тестах."""
    monkeypatch.setattr(pres_app, "_startup_db", lambda: None)
    monkeypatch.setattr(pres_app, "close_pool", lambda: None)
    monkeypatch.setattr(pres_app, "set_catalog_index", lambda _: None)
    monkeypatch.setattr(catalog_mod, "_ensure_catalog_sync", lambda *args, **kwargs: None)
    monkeypatch.setattr(catalog_mod, "_db_session", fake_db_session)
    monkeypatch.setattr("presentation.api.deps.db_session", fake_db_session)
    monkeypatch.setattr("presentation.api.routes.auth.db_session", fake_db_session)
    monkeypatch.setattr("presentation.api.routes.admin.db_session", fake_db_session)
    monkeypatch.setattr(pres_app, "get_connection", lambda: object())
    monkeypatch.setattr(pres_app, "put_connection", lambda conn: None)


def make_test_client(monkeypatch, *, raise_server_exceptions: bool = False) -> TestClient:
    isolate_app(monkeypatch)
    return TestClient(pres_app.app, raise_server_exceptions=raise_server_exceptions)
