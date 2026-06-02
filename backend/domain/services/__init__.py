"""Доменные сервисы — бизнес-логика, не принадлежащая конкретной сущности."""
from domain.services.qp_service import alpha_for_type, ALPHA_BY_TYPE, ALPHA_DEFAULT

__all__ = ["alpha_for_type", "ALPHA_BY_TYPE", "ALPHA_DEFAULT"]
