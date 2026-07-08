"""Тесты подбора по рабочей точке и осевой кривой с седловиной."""
from __future__ import annotations

import pytest

from domain.services.qp_service import build_qp_curve, is_axial_type, pressure_at_flow
from infrastructure.db.product_repository import PgProductRepository
from tests.conftest import make_test_client


def _vo_product(pid: str, q_min: float, q_max: float, p_min: float, p_max: float, price=1000):
    return {
        "id": pid, "number": pid, "type": "Осевой", "model": f"ВО тест-{pid}",
        "size": "456A4", "diameter": 405.0,
        "airflow": {"min": q_min, "max": q_max, "raw": f"{q_min} - {q_max}"},
        "pressure": {"min": p_min, "max": p_max, "raw": f"{p_min} - {p_max}"},
        "power": 120, "noise_level": None, "price": price,
        "nominal_rpm": 1370.0,
        "_raw": {}, "_meta": {},
    }


# ---------------------------------------------------------------------------
# Доменный сервис
# ---------------------------------------------------------------------------

def test_is_axial_type():
    assert is_axial_type("ВО")
    assert is_axial_type("Осевой")
    assert is_axial_type(" осевой ")
    assert not is_axial_type("ВЦ")
    assert not is_axial_type(None)


def test_axial_curve_has_saddle_and_exact_ends():
    curve = build_qp_curve(q_min=900, q_max=3600, p_min=30, p_max=170, fan_type="ВО", points=101)
    ps = [pt.p for pt in curve]

    assert curve[0].q == pytest.approx(900) and curve[0].p == pytest.approx(170)
    assert curve[-1].q == pytest.approx(3600) and curve[-1].p == pytest.approx(30)

    # Седловина: локальный минимум, за ним горб (локальный максимум)
    local_mins = [i for i in range(1, 100) if ps[i] < ps[i - 1] and ps[i] < ps[i + 1]]
    local_maxs = [i for i in range(1, 100) if ps[i] > ps[i - 1] and ps[i] > ps[i + 1]]
    assert local_mins, "у осевой кривой должен быть провал (седловина)"
    assert local_maxs, "у осевой кривой должен быть горб после провала"
    assert local_mins[0] < local_maxs[0], "провал идёт раньше горба"

    # Расход строго возрастает (кривая — функция от Q)
    qs = [pt.q for pt in curve]
    assert all(b > a for a, b in zip(qs, qs[1:]))


def test_centrifugal_curve_has_no_saddle():
    curve = build_qp_curve(q_min=1000, q_max=5000, p_min=100, p_max=600, fan_type="ВЦ", points=101)
    ps = [pt.p for pt in curve]
    # У центробежных седловины нет: лёгкий горб от α допустим (модель из QP_MODEL),
    # но локального минимума с последующим ростом быть не должно
    local_mins = [i for i in range(1, 100) if ps[i] < ps[i - 1] and ps[i] < ps[i + 1]]
    assert not local_mins, "у центробежной кривой не должно быть провала"


def test_pressure_at_flow_inside_and_outside_range():
    kwargs = dict(q_min=900, q_max=3600, p_min=30, p_max=170, fan_type="ВО")
    assert pressure_at_flow(900, **kwargs) == pytest.approx(170, rel=1e-6)
    assert pressure_at_flow(3600, **kwargs) == pytest.approx(30, rel=1e-6)
    mid = pressure_at_flow(2250, **kwargs)
    assert mid is not None and 30 < mid < 170
    assert pressure_at_flow(100, **kwargs) is None
    assert pressure_at_flow(9999, **kwargs) is None


# ---------------------------------------------------------------------------
# Эндпоинт /api/products/select-point
# ---------------------------------------------------------------------------

def test_select_point_filters_and_sorts(monkeypatch):
    # strong: в точке Q=2000 давление высокое; weak: не дотягивает до P
    strong = _vo_product("strong", 900, 3600, 150, 400)
    weak = _vo_product("weak", 900, 3600, 10, 60)
    exact = _vo_product("exact", 900, 3600, 100, 210)

    monkeypatch.setattr(
        PgProductRepository, "list_products",
        lambda self, **kw: [strong, weak, exact],
    )
    client = make_test_client(monkeypatch)

    r = client.get("/api/products/select-point?point_q=2000&point_p=150")
    assert r.status_code == 200
    data = r.json()
    assert data["point"] == {"q": 2000, "p": 150}
    assert data["total_considered"] == 3

    ids = [it["product"]["id"] for it in data["items"]]
    assert "weak" not in ids, "не обеспечивает давление в точке — должен быть отфильтрован"
    assert set(ids) == {"strong", "exact"}

    # Сортировка по запасу: точное попадание первым
    reserves = [it["reserve_percent"] for it in data["items"]]
    assert reserves == sorted(reserves)
    assert ids[0] == "exact"
    for it in data["items"]:
        assert it["p_available"] >= 150


def test_select_point_tolerance_allows_small_deficit(monkeypatch):
    fan = _vo_product("sub", 900, 3600, 60, 160)
    p_avail = pressure_at_flow(2000, q_min=900, q_max=3600, p_min=60, p_max=160, fan_type="Осевой")
    assert p_avail is not None
    point_p = round(p_avail * 1.10, 1)  # точка на 10% выше кривой → дефицит ~9%

    monkeypatch.setattr(PgProductRepository, "list_products", lambda self, **kw: [fan])
    client = make_test_client(monkeypatch)

    base = f"/api/products/select-point?point_q=2000&point_p={point_p}"
    assert client.get(base).json()["items"] == [], "без допуска модель ниже точки не проходит"

    data = client.get(base + "&tolerance=15").json()
    assert [it["product"]["id"] for it in data["items"]] == ["sub"]
    assert data["items"][0]["reserve_percent"] < 0, "дефицит — отрицательный запас"

    assert client.get(base + "&tolerance=99").status_code == 422


def test_select_point_validation(monkeypatch):
    client = make_test_client(monkeypatch)
    assert client.get("/api/products/select-point").status_code == 422
    assert client.get("/api/products/select-point?point_q=0&point_p=100").status_code == 422
    assert client.get("/api/products/select-point?point_q=100&point_p=-5").status_code == 422
