"""Создание учётной записи администратора при первом запуске."""
from __future__ import annotations

import logging

from infrastructure.auth.jwt_service import hash_password
from config import ADMIN_EMAIL, ADMIN_PASSWORD
from infrastructure.db.user_repository import create_user, get_user_by_email

logger = logging.getLogger(__name__)


def ensure_default_admin(conn) -> None:
    """Создать системного администратора, если его ещё нет в БД."""
    email = ADMIN_EMAIL.strip().lower()
    if not email or not ADMIN_PASSWORD:
        logger.warning("ADMIN_EMAIL or ADMIN_PASSWORD not set; skipping default admin bootstrap")
        return
    if get_user_by_email(conn, email):
        return
    create_user(
        conn,
        email=email,
        password_hash=hash_password(ADMIN_PASSWORD),
        name="Администратор",
        company="VENTSEARCH",
        phone="",
        role="admin",
    )
    logger.info("Default admin account created: %s", email)
