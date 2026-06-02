"""
Доменная сущность: Пользователь (User).

Чистый бизнес-объект без зависимостей на БД или HTTP.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


@dataclass
class User:
    """
    Зарегистрированный пользователь системы.

    Бизнес-правила:
    - Роль: 'user' или 'admin'.
    - Защищённый администратор (is_protected=True) не может быть удалён или понижен в правах.
    - В системе должен оставаться хотя бы один активный администратор.
    """

    id: int
    email: str
    name: str = ""
    company: str = ""
    phone: str = ""
    role: str = "user"
    is_active: bool = True
    is_protected: bool = False
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

    def is_admin(self) -> bool:
        return self.role == "admin"

    def can_be_deleted(self) -> bool:
        return not self.is_protected
