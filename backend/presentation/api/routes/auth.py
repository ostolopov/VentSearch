"""Публичное API: регистрация, вход, профиль."""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request

from presentation.api.deps import db_session, get_current_user
from presentation.api.schemas import AuthLoginIn, AuthRegisterIn, AuthTokenOut, UserOut
from infrastructure.auth.jwt_service import create_access_token, hash_password, verify_password
from infrastructure.auth.rate_limit import LoginRateLimiter
from infrastructure.db.user_repository import _public_user, create_user, get_user_by_email

router = APIRouter(prefix="/api/auth", tags=["auth"])

# Общий на процесс лимитер неудачных входов (IP + email)
login_limiter = LoginRateLimiter()


def _login_key(request: Request, email: str) -> str:
    ip = request.client.host if request.client else "unknown"
    return f"{ip}|{email}"


def _token_response(user: dict) -> AuthTokenOut:
    token = create_access_token(user["id"], user["email"], user["role"])
    return AuthTokenOut(access_token=token, user=UserOut.model_validate(user))


@router.post(
    "/register",
    response_model=AuthTokenOut,
    status_code=201,
    summary="Регистрация пользователя",
)
def auth_register(payload: AuthRegisterIn):
    email = payload.email.strip().lower()
    if len(payload.password) < 6:
        raise HTTPException(status_code=422, detail={"error": "Password must be at least 6 characters"})
    with db_session() as conn:
        if get_user_by_email(conn, email):
            raise HTTPException(status_code=409, detail={"error": "Email already registered"})
        user = create_user(
            conn,
            email=email,
            password_hash=hash_password(payload.password),
            name=payload.name.strip(),
            company=payload.company.strip(),
            phone=payload.phone.strip(),
            role="user",
        )
    return _token_response(user)


@router.post("/login", response_model=AuthTokenOut, summary="Вход")
def auth_login(payload: AuthLoginIn, request: Request):
    email = payload.email.strip().lower()
    key = _login_key(request, email)

    retry_after = login_limiter.seconds_until_allowed(key)
    if retry_after > 0:
        raise HTTPException(
            status_code=429,
            detail={"error": "Too many failed attempts, try again later"},
            headers={"Retry-After": str(retry_after)},
        )

    with db_session() as conn:
        row = get_user_by_email(conn, email)
    if not row or not verify_password(payload.password, row["password_hash"]):
        login_limiter.register_failure(key)
        raise HTTPException(status_code=401, detail={"error": "Invalid email or password"})
    if not row.get("is_active"):
        raise HTTPException(status_code=403, detail={"error": "Account is disabled"})
    login_limiter.reset(key)
    return _token_response(_public_user(row))


@router.get("/me", response_model=UserOut, summary="Текущий пользователь")
def auth_me(user: Annotated[dict, Depends(get_current_user)]):
    return UserOut.model_validate(user)
