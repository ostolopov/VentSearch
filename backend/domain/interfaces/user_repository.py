"""
Абстрактный репозиторий пользователей (порт / port).

Инфраструктурный слой предоставляет конкретную реализацию (PostgreSQL).
Прикладной слой и маршруты авторизации работают только с этим контрактом.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional, Tuple


class AbstractUserRepository(ABC):
    """Контракт для работы с пользователями системы."""

    @abstractmethod
    def get_by_id(self, user_id: int) -> Optional[Dict[str, Any]]:
        """Найти пользователя по числовому id."""

    @abstractmethod
    def get_by_email(self, email: str) -> Optional[Dict[str, Any]]:
        """Найти пользователя по email (регистронезависимо)."""

    @abstractmethod
    def list_users(
        self,
        *,
        q: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> Tuple[List[Dict[str, Any]], int]:
        """Список пользователей с поиском; возвращает (строки, total)."""

    @abstractmethod
    def count_admins(self) -> int:
        """Число активных администраторов."""

    @abstractmethod
    def create(
        self,
        *,
        email: str,
        password_hash: str,
        name: str = "",
        company: str = "",
        phone: str = "",
        role: str = "user",
    ) -> Dict[str, Any]:
        """Создать нового пользователя и вернуть публичные поля."""

    @abstractmethod
    def update(
        self,
        user_id: int,
        *,
        email: Optional[str] = None,
        password_hash: Optional[str] = None,
        name: Optional[str] = None,
        company: Optional[str] = None,
        phone: Optional[str] = None,
        role: Optional[str] = None,
        is_active: Optional[bool] = None,
    ) -> Optional[Dict[str, Any]]:
        """Обновить поля пользователя; вернуть None если не найден."""

    @abstractmethod
    def delete(self, user_id: int) -> bool:
        """Удалить пользователя; вернуть False если защищён или не найден."""

    @abstractmethod
    def delete_bulk(
        self,
        user_ids: List[int],
        *,
        acting_admin_id: int,
    ) -> Tuple[int, List[Dict[str, Any]]]:
        """Пакетное удаление; возвращает (число удалённых, ошибки)."""
