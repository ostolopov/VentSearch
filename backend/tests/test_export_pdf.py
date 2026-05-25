from contextlib import contextmanager

from fastapi.testclient import TestClient

import app as app_module


def _make_client(monkeypatch):
    monkeypatch.setattr(app_module, "_startup_db", lambda: None)
    monkeypatch.setattr(app_module, "shutdown_database", lambda: None)
    monkeypatch.setattr(app_module, "_ensure_catalog_sync_with_reindex", lambda: None)
    monkeypatch.setattr(app_module, "set_catalog_index", lambda _: None)

    @contextmanager
    def _fake_db_session():
        yield object()

    monkeypatch.setattr(app_module, "db_session", _fake_db_session)
    return TestClient(app_module.app, raise_server_exceptions=False)


def test_export_pdf_returns_file(monkeypatch):
    sample = {
        "id": "3037",
        "number": "3037",
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
    monkeypatch.setattr(app_module, "get_by_id", lambda *args, **kwargs: sample)
    monkeypatch.setattr(app_module, "get_by_model_or_slug", lambda *args, **kwargs: None)

    client = _make_client(monkeypatch)
    response = client.post("/api/export/pdf", json={"ids": ["3037"], "filename": "check.pdf"})

    assert response.status_code == 200
    assert response.headers.get("content-type", "").startswith("application/pdf")
    assert "attachment;" in response.headers.get("content-disposition", "")
    assert response.content.startswith(b"%PDF")


def test_pdf_fonts_prefers_builtin_dejavu():
    """Helvetica не поддерживает кириллицу; в образе приложения должен лежать DejaVu под backend/fonts/."""
    reg, bold = app_module._pick_pdf_fonts()
    assert reg.startswith("VentPdfRegular-")
    assert bold.startswith("VentPdfBold-") or bold == reg


def test_export_pdf_returns_404_when_not_found(monkeypatch):
    monkeypatch.setattr(app_module, "get_by_id", lambda *args, **kwargs: None)
    monkeypatch.setattr(app_module, "get_by_model_or_slug", lambda *args, **kwargs: None)

    client = _make_client(monkeypatch)
    response = client.post("/api/export/pdf", json={"ids": ["missing"]})

    assert response.status_code == 404
    assert "Product not found" in str(response.json())

