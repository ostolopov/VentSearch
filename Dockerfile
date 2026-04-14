FROM python:3.10-slim

WORKDIR /app

# Устанавливаем зависимости
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Копируем всё содержимое проекта в корень /app
# Это позволит импортам работать так же, как они работают у тебя на MacBook
COPY . .

# Добавляем текущую директорию в пути поиска Python
ENV PYTHONPATH=/app

# Не фиксируем порт через ENV, Яндекс сам его подставит
EXPOSE 8080

# Запускаем через gunicorn, указывая путь к объекту app
# Если app.py лежит в папке backend, то пишем backend.app:app
CMD exec gunicorn --bind :$PORT --workers 1 --threads 8 -k uvicorn.workers.UvicornWorker backend.app:app