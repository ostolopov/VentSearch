@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0backend"

where python >nul 2>&1
if errorlevel 1 (
  echo Python не найден в PATH. Установите Python 3.11+ с python.org и отметьте "Add to PATH".
  exit /b 1
)

if not exist .venv (
  echo Создаю виртуальное окружение .venv...
  python -m venv .venv
)

call .venv\Scripts\activate.bat
python -m pip install -q -r requirements.txt

if not exist .env (
  if exist .env.example (
    echo Копирую .env из .env.example ^(проверьте DATABASE_URL^).
    copy /y .env.example .env >nul
  ) else (
    echo Нет backend\.env — создайте его вручную.
    exit /b 1
  )
)

echo Запуск API: http://127.0.0.1:8000  (документация: /docs)
python app.py
