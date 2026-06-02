"""
Пул соединений к PostgreSQL (SimpleConnectionPool из psycopg2).

Соединение на каждый запрос берётся через get_connection() и возвращается
через put_connection() — всегда в блоке try/finally.
"""
import psycopg2
from psycopg2 import pool

_pool: pool.SimpleConnectionPool | None = None


def init_pool(database_url: str, minconn: int = 1, maxconn: int = 10) -> None:
    """Инициализировать пул; повторный вызов — no-op."""
    global _pool
    if _pool is not None:
        return
    _pool = psycopg2.pool.SimpleConnectionPool(
        minconn=minconn,
        maxconn=maxconn,
        dsn=database_url,
    )


def close_pool() -> None:
    """Закрыть все соединения и освободить пул."""
    global _pool
    if _pool is not None:
        _pool.closeall()
        _pool = None


def get_connection():
    """Взять соединение из пула. Вызывающий ОБЯЗАН вернуть его через put_connection."""
    if _pool is None:
        raise RuntimeError("Connection pool not initialized. Call init_pool first.")
    return _pool.getconn()


def put_connection(conn) -> None:
    """Вернуть соединение в пул."""
    if _pool is not None:
        _pool.putconn(conn)
