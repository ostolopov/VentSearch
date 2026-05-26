import pytest
from domain.services.qp_service import alpha_for_type, ALPHA_DEFAULT

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
