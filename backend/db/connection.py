"""
Пул соединений к PostgreSQL. Подключение на каждый запрос через g.db.
"""
import psycopg2
from psycopg2 import pool

_pool: pool.SimpleConnectionPool | None = None


def init_pool(database_url: str, minconn: int = 1, maxconn: int = 10) -> None:
    global _pool
    if _pool is not None:
        return
    _pool = psycopg2.pool.SimpleConnectionPool(
        minconn=minconn,
        maxconn=maxconn,
        dsn=database_url,
    )


def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.closeall()
        _pool = None


def get_connection():
    """Взять соединение из пула. Вызывающий должен вернуть его через put_connection."""
    if _pool is None:
        raise RuntimeError("Connection pool not initialized. Call init_pool first.")
    return _pool.getconn()


def put_connection(conn) -> None:
    """Вернуть соединение в пул."""
    if _pool is not None:
        _pool.putconn(conn)
