"""
Конфигурация приложения из переменных окружения.
Перед импортом config должен быть загружен .env (см. app.py).
"""
import os
from pathlib import Path

_BACKEND_DIR = Path(__file__).resolve().parent
REPO_ROOT = _BACKEND_DIR.parent

# CSV каталога: по умолчанию data/ в корне репозитория
_default_csv = REPO_ROOT / "data" / "ventsearch_massive_sorted.csv"
CSV_PATH = Path(os.environ.get("CSV_PATH", str(_default_csv)))

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://localhost/ventmash",
)

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
