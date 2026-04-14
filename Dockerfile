FROM python:3.10-slim

WORKDIR /app

# Устанавливаем зависимости
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Копируем исходники и данные
# Важно: копируем так, чтобы структура внутри /app совпадала с твоей локальной
COPY backend/ ./backend/
COPY data/ ./data/

# Устанавливаем PYTHONPATH, чтобы python видел папку backend
ENV PYTHONPATH=/app

# Не фиксируем порт через ENV, Яндекс сам его подставит
EXPOSE 8080

# Используем "exec" форму и правильный путь к приложению
CMD exec gunicorn --bind :$PORT --workers 1 --threads 8 -k uvicorn.workers.UvicornWorker backend.app:app