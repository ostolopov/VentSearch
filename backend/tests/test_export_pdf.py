from infrastructure.db.product_repository import PgProductRepository
from presentation.app import _pick_fonts
from tests.conftest import make_test_client


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
    monkeypatch.setattr(PgProductRepository, "get_by_id", lambda self, id_value: sample)
    monkeypatch.setattr(PgProductRepository, "get_by_model_or_slug", lambda self, m, s: None)

    client = make_test_client(monkeypatch)
    response = client.post("/api/export/pdf", json={"ids": ["3037"], "filename": "check.pdf"})

    assert response.status_code == 200
    assert response.headers.get("content-type", "").startswith("application/pdf")
    assert "attachment;" in response.headers.get("content-disposition", "")
    assert response.content.startswith(b"%PDF")


def test_pdf_fonts_prefers_builtin_dejavu():
    """Helvetica не поддерживает кириллицу; в образе приложения должен лежать DejaVu под backend/fonts/."""
    reg, bold = _pick_fonts()
    assert reg.startswith("VentPdfRegular-")
    assert bold.startswith("VentPdfBold-") or bold == reg


def test_export_pdf_returns_404_when_not_found(monkeypatch):
    monkeypatch.setattr(PgProductRepository, "get_by_id", lambda self, id_value: None)
    monkeypatch.setattr(PgProductRepository, "get_by_model_or_slug", lambda self, m, s: None)

    client = make_test_client(monkeypatch)
    response = client.post("/api/export/pdf", json={"ids": ["missing"]})

    assert response.status_code == 404
    assert "Product not found" in str(response.json())
