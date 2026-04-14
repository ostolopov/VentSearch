"""
Подключение FastAPI к PostgreSQL: пул соединений и проверка при старте приложения.
Настройки строки подключения — в config (переменная окружения DATABASE_URL).
"""
import logging
import os

import psycopg2

from backend.config import DATABASE_URL
from backend.db.connection import close_pool, get_connection, init_pool, put_connection

logger = logging.getLogger(__name__)

POOL_MIN_CONN = int(os.environ.get("DB_POOL_MIN", "1"))
POOL_MAX_CONN = int(os.environ.get("DB_POOL_MAX", "10"))


def init_database() -> None:
    """
    Создаёт пул соединений к PostgreSQL и проверяет доступность СУБД.
    При успехе пишет в лог версию сервера (результат SELECT version()).
    """
    try:
        init_pool(
            DATABASE_URL,
            minconn=POOL_MIN_CONN,
            maxconn=POOL_MAX_CONN,
        )
    except psycopg2.OperationalError as e:
        err = str(e).lower()
        if "password" in err or "fe_sendauth" in err:
            logger.error(
                "PostgreSQL: нет пароля или неверные учётные данные. В backend/.env укажите пароль: "
                "либо postgresql://ПОЛЬЗОВАТЕЛЬ:ПАРОЛЬ@127.0.0.1:5432/БД, "
                "либо DATABASE_URL=postgresql://ПОЛЬЗОВАТЕЛЬ@127.0.0.1:5432/БД и отдельно DATABASE_PASSWORD=… "
                "(см. backend/.env.example)."
            )
        raise
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT version();")
            row = cur.fetchone()
        version_line = (row[0] if row else "").strip()
        short = version_line.split(",")[0] if version_line else "unknown"
        logger.info("База данных PostgreSQL подключена: %s", short)
    finally:
        put_connection(conn)


def shutdown_database() -> None:
    """Закрывает пул соединений при остановке приложения."""
    close_pool()
    logger.info("Соединения с PostgreSQL закрыты (пул освобождён).")
