import pytest
from domain.services.qp_service import (
    alpha_for_type, ALPHA_DEFAULT, build_qp_curve, shape_points_for_model,
    _DIGITIZED_SHAPES,
)

def test_alpha_known_types():
    assert alpha_for_type("ВО") == 0.18
    assert alpha_for_type("ВЦ") == 0.05
    assert alpha_for_type("ВКОП") == 0.15

def test_alpha_unknown_type():
    assert alpha_for_type("неведомая_фигня") == ALPHA_DEFAULT

def test_alpha_none_or_empty():
    assert alpha_for_type(None) == ALPHA_DEFAULT
    assert alpha_for_type("") == ALPHA_DEFAULT
    assert alpha_for_type(" ") == ALPHA_DEFAULT

def test_alpha_with_whitespace():
    assert alpha_for_type(" ВО ") == 0.18


# --- Оцифрованные реальные формы кривых (ВО 13-284) ---------------------

@pytest.mark.parametrize("model,blades,angle", [
    ("ВО 13-284-4/15°-456A4", "4", "15"),
    ("ВО 13-284-12к/25°-12,5132M8", "12к", "25"),
    ("ВО 13-284-8/30°-7,1100L4", "8", "30"),
])
def test_shape_points_found_for_known_models(model, blades, angle):
    pts = shape_points_for_model(model)
    assert pts is not None
    assert pts[0] == (0.0, 1.0)
    assert pts[-1] == (1.0, 0.0)
    assert len(pts) >= 10

def test_shape_points_none_for_unknown_model():
    assert shape_points_for_model("ВЦ 4-75-2,5") is None
    assert shape_points_for_model(None) is None
    assert shape_points_for_model("") is None

def test_shape_points_monotonic_no_dip():
    """Реальные оцифрованные кривые не имеют искусственного провала/горба."""
    for model in ["ВО 13-284-6/20°", "ВО 13-284-10/25°", "ВО 13-284-12к/45°"]:
        pts = shape_points_for_model(model)
        p_values = [p for _, p in pts]
        # не строго убывает поточечно (шум трассировки), но не должно быть
        # большого отскока вверх нигде на кривой
        for a, b in zip(p_values, p_values[1:]):
            assert b <= a + 0.02

def test_all_digitized_shapes_strictly_non_increasing():
    """
    Регрессия: один traced-артефакт (6/30°, колебание на конце q_frac=0.9..0.95)
    проскочил через прежнюю проверку truncate-after-global-min. Теперь каждая
    точка из всех 19 оцифрованных форм обязана быть <= предыдущей без допуска.
    """
    assert len(_DIGITIZED_SHAPES) == 5
    checked = 0
    for blade, angles in _DIGITIZED_SHAPES.items():
        for angle, points in angles.items():
            p_values = [p for _, p in points]
            for a, b in zip(p_values, p_values[1:]):
                assert b <= a, f"{blade}/{angle}°: {a} -> {b} возрастает"
            checked += 1
    assert checked == 19

def test_build_qp_curve_uses_digitized_shape_when_available():
    curve = build_qp_curve(
        q_min=0.29, q_max=0.7, p_min=69, p_max=26,
        fan_type="Осевой", model="ВО 13-284-6/15°-456A4", points=25,
    )
    ps = [pt.p for pt in curve]
    # монотонно убывает (в пределах допуска на шум трассировки) — без искусственного провала
    assert max(ps) == pytest.approx(69, abs=0.5)
    assert min(ps) == pytest.approx(26, abs=0.5)
    for a, b in zip(ps, ps[1:]):
        assert b <= a + 1.0

def test_build_qp_curve_falls_back_to_bezier_for_unknown_model():
    curve = build_qp_curve(
        q_min=1.0, q_max=2.0, p_min=200, p_max=100,
        fan_type="Осевой", model="ВЦ какая-то другая модель", points=25,
    )
    assert len(curve) == 25
    assert curve[0].q == pytest.approx(1.0)
    assert curve[-1].q == pytest.approx(2.0)

def test_build_qp_curve_pressure_coefficients_take_priority_over_shape():
    curve = build_qp_curve(
        q_min=0.29, q_max=0.7, p_min=69, p_max=26,
        fan_type="Осевой", model="ВО 13-284-6/15°-456A4",
        pressure_coefficients=[26.0], points=5,
    )
    assert all(pt.p == pytest.approx(26.0) for pt in curve)
