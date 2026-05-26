"""
PostgreSQL-реализация репозитория пользователей.

Реализует AbstractUserRepository из domain/interfaces.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from psycopg2.extras import RealDictCursor

from config import ADMIN_EMAIL
from domain.interfaces.user_repository import AbstractUserRepository


def is_protected_admin_account(user: Dict[str, Any]) -> bool:
    """Системный администратор из ADMIN_EMAIL не может быть удалён."""
    email = (user.get("email") or "").strip().lower()
    protected = ADMIN_EMAIL.strip().lower()
    return bool(email and protected and email == protected)


def _public_user(row: Dict[str, Any]) -> Dict[str, Any]:
    """Вернуть словарь публичных полей пользователя (без password_hash)."""
    return {
        "id": row["id"],
        "email": row["email"],
        "name": row.get("name") or "",
        "company": row.get("company") or "",
        "phone": row.get("phone") or "",
        "role": row.get("role") or "user",
        "is_active": bool(row.get("is_active")),
        "created_at": row["created_at"].isoformat() if row.get("created_at") else None,
        "updated_at": row["updated_at"].isoformat() if row.get("updated_at") else None,
        "is_protected": is_protected_admin_account(row),
    }


_SELECT_COLS = (
    "id, email, password_hash, name, company, phone, role, is_active, created_at, updated_at"
)
_PUBLIC_COLS = (
    "id, email, name, company, phone, role, is_active, created_at, updated_at"
)


class PgUserRepository(AbstractUserRepository):
    """Реализация репозитория пользователей поверх PostgreSQL-соединения."""

    def __init__(self, conn) -> None:
        self._conn = conn

    def get_by_id(self, user_id: int) -> Optional[Dict[str, Any]]:
        with self._conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                f"SELECT {_SELECT_COLS} FROM users WHERE id = %s", (user_id,)
            )
            row = cur.fetchone()
        return dict(row) if row else None

    def get_by_email(self, email: str) -> Optional[Dict[str, Any]]:
        with self._conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                f"SELECT {_SELECT_COLS} FROM users WHERE LOWER(email) = %s",
                (email.strip().lower(),),
            )
            row = cur.fetchone()
        return dict(row) if row else None

    def list_users(
        self,
        *,
        q: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> Tuple[List[Dict[str, Any]], int]:
        conditions = ["1=1"]
        params: List[Any] = []
        if q and q.strip():
            t = f"%{q.strip().lower()}%"
            conditions.append(
                "(LOWER(email) LIKE %s OR LOWER(name) LIKE %s OR LOWER(company) LIKE %s)"
            )
            params.extend([t, t, t])
        where_sql = " AND ".join(conditions)
        with self._conn.cursor() as cur:
            cur.execute(f"SELECT COUNT(*) FROM users WHERE {where_sql}", params)
            total = int(cur.fetchone()[0])
        with self._conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                f"SELECT {_PUBLIC_COLS} FROM users WHERE {where_sql} "
                "ORDER BY id DESC LIMIT %s OFFSET %s",
                [*params, limit, offset],
            )
            rows = cur.fetchall()
        return [_public_user(dict(r)) for r in rows], total

    def count_admins(self) -> int:
        with self._conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM users WHERE role = 'admin' AND is_active = TRUE")
            return int(cur.fetchone()[0])

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
        with self._conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                INSERT INTO users (email, password_hash, name, company, phone, role)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING id, email, name, company, phone, role, is_active, created_at, updated_at
                """,
                (email.strip().lower(), password_hash, name, company, phone, role),
            )
            row = cur.fetchone()
        self._conn.commit()
        return _public_user(dict(row))

    def update(
        self,
        user_id: int,
        *,
        email=None, password_hash=None, name=None,
        company=None, phone=None, role=None, is_active=None,
    ) -> Optional[Dict[str, Any]]:
        fields: List[str] = []
        params: List[Any] = []
        if email is not None:
            fields.append("email = %s")
            params.append(email.strip().lower())
        if password_hash is not None:
            fields.append("password_hash = %s")
            params.append(password_hash)
        if name is not None:
            fields.append("name = %s")
            params.append(name)
        if company is not None:
            fields.append("company = %s")
            params.append(company)
        if phone is not None:
            fields.append("phone = %s")
            params.append(phone)
        if role is not None:
            fields.append("role = %s")
            params.append(role)
        if is_active is not None:
            fields.append("is_active = %s")
            params.append(is_active)
        if not fields:
            row = self.get_by_id(user_id)
            return _public_user(row) if row else None
        params.append(user_id)
        with self._conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                f"UPDATE users SET {', '.join(fields)} WHERE id = %s "
                "RETURNING id, email, name, company, phone, role, is_active, created_at, updated_at",
                params,
            )
            row = cur.fetchone()
        self._conn.commit()
        return _public_user(dict(row)) if row else None

    def delete(self, user_id: int) -> bool:
        existing = self.get_by_id(user_id)
        if not existing or is_protected_admin_account(existing):
            return False
        with self._conn.cursor() as cur:
            cur.execute("DELETE FROM users WHERE id = %s", (user_id,))
            deleted = cur.rowcount > 0
        self._conn.commit()
        return deleted

    def delete_bulk(
        self,
        user_ids: List[int],
        *,
        acting_admin_id: int,
    ) -> Tuple[int, List[Dict[str, Any]]]:
        unique_ids = list(dict.fromkeys(int(i) for i in user_ids))
        errors: List[Dict[str, Any]] = []
        candidates: List[Dict[str, Any]] = []

        for user_id in unique_ids:
            if user_id == acting_admin_id:
                errors.append({"id": user_id, "error": "Cannot delete your own account"})
                continue
            existing = self.get_by_id(user_id)
            if not existing:
                errors.append({"id": user_id, "error": "User not found"})
                continue
            if is_protected_admin_account(existing):
                errors.append({"id": user_id, "error": "Cannot delete protected admin account"})
                continue
            candidates.append(existing)

        admin_count = self.count_admins()
        admins_to_delete = [c for c in candidates if c.get("role") == "admin"]
        if admins_to_delete and admin_count - len(admins_to_delete) < 1:
            for row in admins_to_delete:
                errors.append({"id": row["id"], "error": "Cannot delete the last admin"})
            candidates = [c for c in candidates if c.get("role") != "admin"]

        allowed_ids = [c["id"] for c in candidates]
        if not allowed_ids:
            return 0, errors

        with self._conn.cursor() as cur:
            cur.execute("DELETE FROM users WHERE id = ANY(%s)", (allowed_ids,))
            deleted = int(cur.rowcount)
        self._conn.commit()
        return deleted, errors


# ---------------------------------------------------------------------------
# Module-level functions (backward compat)
# ---------------------------------------------------------------------------

def get_user_by_id(conn, user_id: int) -> Optional[Dict[str, Any]]:
    return PgUserRepository(conn).get_by_id(user_id)


def get_user_by_email(conn, email: str) -> Optional[Dict[str, Any]]:
    return PgUserRepository(conn).get_by_email(email)


def list_users(conn, *, q=None, limit=50, offset=0):
    return PgUserRepository(conn).list_users(q=q, limit=limit, offset=offset)


def count_admins(conn) -> int:
    return PgUserRepository(conn).count_admins()


def create_user(conn, *, email, password_hash, name="", company="", phone="", role="user"):
    return PgUserRepository(conn).create(
        email=email, password_hash=password_hash,
        name=name, company=company, phone=phone, role=role,
    )


def update_user(conn, user_id, *, email=None, password_hash=None, name=None,
                company=None, phone=None, role=None, is_active=None):
    return PgUserRepository(conn).update(
        user_id, email=email, password_hash=password_hash,
        name=name, company=company, phone=phone, role=role, is_active=is_active,
    )


def delete_user(conn, user_id: int) -> bool:
    return PgUserRepository(conn).delete(user_id)


def delete_users_bulk(conn, user_ids, *, acting_admin_id):
    return PgUserRepository(conn).delete_bulk(user_ids, acting_admin_id=acting_admin_id)
