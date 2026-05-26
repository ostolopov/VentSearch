"""
Инфраструктурный сервис аутентификации:
- Хеширование паролей (bcrypt).
- Создание и проверка JWT-токенов.

Зависит от config (JWT_SECRET, JWT_EXPIRE_HOURS). Не знает о FastAPI или БД.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import bcrypt
import jwt

from config import JWT_EXPIRE_HOURS, JWT_SECRET


def hash_password(password: str) -> str:
    """Захешировать пароль через bcrypt."""
    raw = password.encode("utf-8")
    return bcrypt.hashpw(raw, bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    """Проверить пароль против хеша; вернуть False при любой ошибке."""
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def create_access_token(user_id: int, email: str, role: str) -> str:
    """Создать подписанный JWT-токен для пользователя."""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "email": email,
        "role": role,
        "iat": now,
        "exp": now + timedelta(hours=JWT_EXPIRE_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def decode_access_token(token: str) -> Optional[dict[str, Any]]:
    """Раскодировать токен; вернуть None если невалиден или просрочен."""
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
