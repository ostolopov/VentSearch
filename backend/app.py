"""
Точка входа приложения VENTSEARCH.

Импортирует FastAPI-приложение из presentation/app.py (Onion Architecture).
Этот модуль — тонкий адаптер для совместимости с gunicorn/uvicorn и Dockerfile:
    gunicorn backend.app:app -k uvicorn.workers.UvicornWorker
"""
import uvicorn

from presentation.app import app  # noqa: F401 — экспортируем для ASGI-сервера

if __name__ == "__main__":
    from config import PORT

    uvicorn.run("app:app", host="0.0.0.0", port=PORT, reload=True)
