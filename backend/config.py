"""
Конфигурация приложения из переменных окружения.
Перед импортом config должен быть загружен .env (см. app.py).
"""
import os
from pathlib import Path
from urllib.parse import quote, urlparse, urlunparse

_BACKEND_DIR = Path(__file__).resolve().parent
REPO_ROOT = _BACKEND_DIR.parent

# CSV каталога: по умолчанию data/ в корне репозитория
_default_csv = REPO_ROOT / "data" / "ventsearch_massive_sorted.csv"
CSV_PATH = Path(os.environ.get("CSV_PATH", str(_default_csv)))


def _database_url_with_password_from_env(raw: str) -> str:
    """
    Если в URL нет пароля, подставляет DATABASE_PASSWORD или POSTGRES_PASSWORD из окружения.
    Удобно, когда пароль не хочется вписывать в саму строку URL.
    """
    extra = (os.environ.get("DATABASE_PASSWORD") or os.environ.get("POSTGRES_PASSWORD") or "").strip()
    if not extra:
        return raw
    p = urlparse(raw)
    if p.password is not None and p.password != "":
        return raw
    user = (p.username or os.environ.get("DATABASE_USER") or "").strip()
    if not user:
        return raw
    host = p.hostname or "localhost"
    port = p.port
    path = p.path if p.path else "/"
    user_enc = quote(user, safe="")
    pw_enc = quote(extra, safe="")
    netloc = f"{user_enc}:{pw_enc}@{host}" + (f":{port}" if port else "")
    return urlunparse((p.scheme, netloc, path, p.params, p.query, p.fragment))


_raw_db_url = os.environ.get("DATABASE_URL", "postgresql://localhost/ventmash")
DATABASE_URL = _database_url_with_password_from_env(_raw_db_url)

PORT = int(os.environ.get("PORT", "8000"))

# Список origin фронтенда для CORS (через запятую), например http://localhost:5500
_default_origins = (
    "http://localhost:5500,"
    "http://127.0.0.1:5500,"
    "http://localhost:5173,"
    "http://127.0.0.1:5173,"
    "http://localhost:3000,"
    "http://127.0.0.1:3000,"
    "http://localhost:8080,"
    "http://127.0.0.1:8080"
)
CORS_ORIGINS = [
    o.strip()
    for o in os.environ.get("CORS_ORIGINS", _default_origins).split(",")
    if o.strip()
]
