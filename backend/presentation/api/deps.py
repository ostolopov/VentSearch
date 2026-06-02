"""Зависимости FastAPI: сессия БД и проверка прав."""
from __future__ import annotations

from contextlib import contextmanager
from typing import Annotated, Generator

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from infrastructure.auth.jwt_service import decode_access_token
from infrastructure.db.connection import get_connection, put_connection
from infrastructure.db.user_repository import _public_user, get_user_by_id

_bearer = HTTPBearer(auto_error=False)


@contextmanager
def db_session() -> Generator:
    conn = get_connection()
    try:
        yield conn
    finally:
        put_connection(conn)


def _user_from_token(credentials: HTTPAuthorizationCredentials | None) -> dict:
    if not credentials or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail={"error": "Not authenticated"})
    payload = decode_access_token(credentials.credentials)
    if not payload or not payload.get("sub"):
        raise HTTPException(status_code=401, detail={"error": "Invalid or expired token"})
    user_id = int(payload["sub"])
    with db_session() as conn:
        row = get_user_by_id(conn, user_id)
    if not row:
        raise HTTPException(status_code=401, detail={"error": "User not found"})
    if not row.get("is_active"):
        raise HTTPException(status_code=403, detail={"error": "Account is disabled"})
    return _public_user(row)


def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> dict:
    return _user_from_token(credentials)


def require_admin(
    user: Annotated[dict, Depends(get_current_user)],
) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail={"error": "Admin access required"})
    return user
