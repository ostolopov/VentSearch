"""
Синхронизация каталога с CSV: дешёвая проверка по mtime + размеру, SHA-256 только при расхождении.
"""
import hashlib
import logging
from pathlib import Path
from typing import Any, Dict, Optional

from backend.db.load_csv import load_csv_into_db
from backend.db.repository import count_products

logger = logging.getLogger(__name__)

_CHUNK = 1 << 20  # 1 MiB


def _file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            chunk = f.read(_CHUNK)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def _get_state(conn) -> Optional[Dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT csv_path, mtime_ns, size_bytes, sha256_hex FROM catalog_csv_state WHERE id = 1"
        )
        row = cur.fetchone()
    if not row:
        return None
    return {
        "csv_path": row[0],
        "mtime_ns": int(row[1]),
        "size_bytes": int(row[2]),
        "sha256_hex": row[3],
    }


def _save_state(conn, path_str: str, mtime_ns: int, size_bytes: int, sha256_hex: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO catalog_csv_state (id, csv_path, mtime_ns, size_bytes, sha256_hex)
            VALUES (1, %s, %s, %s, %s)
            ON CONFLICT (id) DO UPDATE SET
                csv_path = EXCLUDED.csv_path,
                mtime_ns = EXCLUDED.mtime_ns,
                size_bytes = EXCLUDED.size_bytes,
                sha256_hex = EXCLUDED.sha256_hex
            """,
            (path_str, mtime_ns, size_bytes, sha256_hex),
        )


def _clear_products(conn) -> None:
    with conn.cursor() as cur:
        cur.execute("DELETE FROM products")


def _reload_from_csv(
    conn,
    resolved: Path,
    path_str: str,
    mtime_ns: int,
    size_bytes: int,
    *,
    sha256_hex: Optional[str] = None,
) -> None:
    _clear_products(conn)
    load_csv_into_db(conn, resolved)
    sha = sha256_hex if sha256_hex is not None else _file_sha256(resolved)
    _save_state(conn, path_str, mtime_ns, size_bytes, sha)
    conn.commit()


def sync_catalog_from_csv(conn, csv_path: Path) -> bool:
    """
    При необходимости перезагружает каталог из CSV.

    Быстрый путь: совпадение сохранённых mtime_ns и size_bytes с текущим файлом — без чтения файла.
    Если размер/mtime отличаются — считается SHA-256; при совпадении с сохранённым хешем обновляются
    только mtime/size (содержимое то же). Иначе — полная перезагрузка таблицы products.

    Возвращает True, если выполнялась перезагрузка данных из CSV.
    """
    if not csv_path.exists():
        return False

    resolved = csv_path.resolve()
    path_str = str(resolved)
    try:
        st = resolved.stat()
    except OSError as e:
        logger.warning("Не удалось прочитать метаданные CSV %s: %s", resolved, e)
        return False

    mtime_ns = int(st.st_mtime_ns)
    size_bytes = int(st.st_size)

    state = _get_state(conn)

    if state and state["csv_path"] == path_str and state["mtime_ns"] == mtime_ns and state["size_bytes"] == size_bytes:
        return False

    if state is None and count_products(conn) == 0:
        load_csv_into_db(conn, resolved)
        current_hash = _file_sha256(resolved)
        _save_state(conn, path_str, mtime_ns, size_bytes, current_hash)
        conn.commit()
        return True

    current_hash = _file_sha256(resolved)

    if state and state["csv_path"] == path_str and state["sha256_hex"] == current_hash:
        _save_state(conn, path_str, mtime_ns, size_bytes, current_hash)
        conn.commit()
        return False

    if state and state["csv_path"] != path_str:
        logger.info("CSV_PATH сменился (%s -> %s), полная перезагрузка каталога", state["csv_path"], path_str)
        _reload_from_csv(conn, resolved, path_str, mtime_ns, size_bytes, sha256_hex=current_hash)
        return True

    if state is None:
        logger.info(
            "Первая запись отпечатка CSV (каталог уже в БД), переимпорт не выполняется; "
            "при следующем изменении файла данные обновятся автоматически."
        )
        _save_state(conn, path_str, mtime_ns, size_bytes, current_hash)
        conn.commit()
        return False

    logger.info("Содержимое CSV изменилось (хеш не совпадает), перезагрузка каталога из файла")
    _reload_from_csv(conn, resolved, path_str, mtime_ns, size_bytes, sha256_hex=current_hash)
    return True
