FROM python:3.10-slim

WORKDIR /app

# Install backend dependencies.
COPY backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# Copy application source and data files.
COPY backend/ /app/backend/
COPY data/ /app/data/

ENV PYTHONPATH=/app/backend
ENV PORT=8080
EXPOSE 8080

CMD gunicorn --bind :"$PORT" --workers 1 --threads 8 -k uvicorn.workers.UvicornWorker app:app
