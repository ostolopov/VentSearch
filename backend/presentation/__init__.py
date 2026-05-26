"""
Презентационный слой (Presentation Layer) — самый внешний слой луковицы.

Содержит:
- FastAPI-приложение (app.py) со стартовой логикой.
- API-маршруты (api/routes/) — HTTP-контроллеры.
- Pydantic-схемы (api/schemas.py) — request/response модели.
- FastAPI-зависимости (api/deps.py) — авторизация, сессия БД.

Зависит от: application (use cases), infrastructure (репозитории, auth).
"""
