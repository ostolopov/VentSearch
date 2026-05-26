# secrets/ — Файлы с секретами VentSearch

Все переменные окружения хранятся **только здесь**.
Папка добавлена в `.gitignore` — **никогда не попадает в git**.

## Файлы

| Файл | Среда | В git? | Описание |
|------|-------|--------|----------|
| `.env.local.example` | Разработка | ✅ Да | Шаблон — безопасные дефолты, без паролей |
| `.env.local` | Разработка | ❌ Нет | Реальные секреты для локальной работы |
| `.env.prod` | Продакшн | ❌ Нет | Реальные секреты для сервера |

---

## Локальная разработка

### Первая настройка
```bash
cp secrets/.env.local.example secrets/.env.local
# при необходимости отредактируйте DATABASE_URL и другие параметры
```

### Запуск БД
```bash
docker compose -f deploy/docker-compose.dev.yml up -d
```

### Запуск API
```bash
bash deploy/run.sh        # macOS / Linux
deploy\run.bat            # Windows
```

---

## Продакшн-сервер

### Заполнить secrets/.env.prod
Отредактируйте `secrets/.env.prod` — **замените все `CHANGE_ME_*`** на реальные значения.

Генерация `JWT_SECRET`:
```bash
python -c "import secrets; print(secrets.token_hex(64))"
```

### Скопировать на сервер (один раз или при смене секретов)
```bash
scp -r secrets/ user@your-server:~/apps/ventsearch/secrets/
```

### Деплой
После копирования секретов на сервер GitHub Actions задеплоит код автоматически при пуше в `main`.

Ручной деплой на сервере:
```bash
cd ~/apps/ventsearch
docker compose -f deploy/compose.prod.yml --env-file secrets/.env.prod up -d --build
```

---

## Переменные окружения

| Переменная | Локально | Продакшн | Описание |
|-----------|----------|----------|----------|
| `DATABASE_URL` | `postgresql://ventmash:ventpass@127.0.0.1:5432/ventmash` | Полный URL с паролем | Строка подключения к PostgreSQL |
| `PORT` | `8000` | `8080` | Порт HTTP-сервера |
| `JWT_SECRET` | `change-me-local-dev-only` | **Случайная строка 64 hex** | Подпись JWT-токенов |
| `JWT_EXPIRE_HOURS` | `168` | `168` | Срок жизни токена (7 суток) |
| `ADMIN_EMAIL` | `admin@ventsearch.local` | Реальный email | Email первого администратора |
| `ADMIN_PASSWORD` | `admin123` | **Сильный пароль** | Пароль первого администратора |
| `CORS_ORIGINS` | `http://localhost:5500,...` | `https://your-domain.ru` | Разрешённые origin |
| `POSTGRES_DB` | — | `ventmash` | Только для compose.prod.yml |
| `POSTGRES_USER` | — | `ventmash` | Только для compose.prod.yml |
| `POSTGRES_PASSWORD` | — | **Сильный пароль** | Только для compose.prod.yml |
