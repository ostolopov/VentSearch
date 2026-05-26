"""Абстрактные интерфейсы репозиториев (Ports)."""
from domain.interfaces.product_repository import AbstractProductRepository
from domain.interfaces.user_repository import AbstractUserRepository

__all__ = ["AbstractProductRepository", "AbstractUserRepository"]
