"""
Тесты валидации диапазонов при создании/редактировании вентилятора в админке.

Контекст: pressure_min/pressure_max в этом каталоге означают «давление при
Q_min» / «давление при Q_max», а не арифметические границы — давление обычно
падает с ростом расхода, поэтому pressure_min > pressure_max это норма
(см. domain/services/qp_service.build_qp_curve, который берёт max()/min() из
пары). Расход, наоборот, всегда возрастает: airflow_min > airflow_max — это
всегда ошибка ввода.
"""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from infrastructure.auth.jwt_service import create_access_token
from presentation.api.schemas import AdminProductIn
from tests.conftest import make_test_client


def _base_payload(**overrides):
    payload = {
        "id": "test-1",
        "type": "Осевой",
        "model": "ВО тест",
        "size": "456A4",
        "airflow_min": 900,
        "airflow_max": 3600,
        "pressure_min": 260,
        "pressure_max": 120,
    }
    payload.update(overrides)
    return payload


def _auth_headers() -> dict:
    token = create_access_token(1, "admin@ventsearch.local", "admin")
    return {"Authorization": f"Bearer {token}"}


def _fake_admin_row() -> dict:
    return {
        "id": 1, "email": "admin@ventsearch.local", "password_hash": "x",
        "name": "Admin", "company": "", "phone": "", "role": "admin",
        "is_active": True, "created_at": None, "updated_at": None,
    }


# ---------------------------------------------------------------------------
# Схема (без HTTP)
# ---------------------------------------------------------------------------

def test_pressure_min_greater_than_max_is_allowed():
    # Давление падает с расходом — pressure_min(260) > pressure_max(120) норма
    product = AdminProductIn(**_base_payload(pressure_min=260, pressure_max=120))
    assert product.pressure_min == 260
    assert product.pressure_max == 120


def test_airflow_min_greater_than_max_is_rejected():
    with pytest.raises(ValidationError, match="Расход"):
        AdminProductIn(**_base_payload(airflow_min=3600, airflow_max=900))


@pytest.mark.parametrize("field", ["airflow_min", "airflow_max", "pressure_min", "pressure_max"])
def test_zero_or_negative_range_values_rejected(field):
    with pytest.raises(ValidationError):
        AdminProductIn(**_base_payload(**{field: 0}))
    with pytest.raises(ValidationError):
        AdminProductIn(**_base_payload(**{field: -5}))


def test_none_range_values_do_not_trigger_validators():
    # Частичное обновление (поле не задано) не должно падать на сравнении с None
    product = AdminProductIn(**_base_payload(airflow_min=None, airflow_max=None))
    assert product.airflow_min is None


# ---------------------------------------------------------------------------
# HTTP: полный путь через кастомный обработчик RequestValidationError —
# именно тут ловится регрессия "TypeError: Object of type ValueError is not
# JSON serializable" (ctx.error у pydantic v2 несериализуем без jsonable_encoder)
# ---------------------------------------------------------------------------

def test_update_product_rejects_inverted_airflow_with_clean_422(monkeypatch):
    monkeypatch.setattr(
        "presentation.api.deps.get_user_by_id", lambda conn, uid: _fake_admin_row()
    )
    client = make_test_client(monkeypatch)

    r = client.put(
        "/api/admin/products/test-1",
        json=_base_payload(airflow_min=3600, airflow_max=900),
        headers=_auth_headers(),
    )
    assert r.status_code == 422
    body = r.json()
    assert "Расход" in body["detail"][0]["msg"]


def test_update_product_accepts_normal_decreasing_pressure(monkeypatch):
    monkeypatch.setattr(
        "presentation.api.deps.get_user_by_id", lambda conn, uid: _fake_admin_row()
    )
    saved = {}

    def _fake_update_product(conn, product_id, data):
        saved.update(data)
        return {
            "id": product_id, "number": product_id, "type": data.get("type", ""),
            "model": data.get("model", ""), "size": data.get("size", ""),
            "diameter": data.get("diameter"),
            "airflow": {"min": data.get("airflow_min"), "max": data.get("airflow_max"), "raw": ""},
            "pressure": {"min": data.get("pressure_min"), "max": data.get("pressure_max"), "raw": ""},
            "power": data.get("power"), "noise_level": data.get("noise_level"),
            "price": data.get("price"), "nominal_rpm": None,
            "pressure_coefficients": None, "efficiency_coefficients": None,
            "_raw": {}, "_meta": {},
        }

    monkeypatch.setattr("presentation.api.routes.admin.update_product", _fake_update_product)
    monkeypatch.setattr("presentation.api.routes.admin._rebuild_catalog_index", lambda: None)
    client = make_test_client(monkeypatch)

    r = client.put(
        "/api/admin/products/test-1",
        json=_base_payload(pressure_min=260, pressure_max=120),
        headers=_auth_headers(),
    )
    assert r.status_code == 200
    assert saved["pressure_min"] == 260
    assert saved["pressure_max"] == 120
