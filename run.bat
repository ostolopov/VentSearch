@echo off
setlocal
cd /d "%~dp0backend"

where python >nul 2>&1
if errorlevel 1 (
  echo ERROR: Python not found in PATH. Install Python 3.11+ from python.org and check "Add Python to PATH".
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo Creating virtual environment .venv ...
  python -m venv .venv
)

if not exist ".venv\Scripts\python.exe" (
  echo ERROR: .venv\Scripts\python.exe not found. venv creation failed. Try: python -m venv .venv
  exit /b 1
)

set "VPY=%CD%\.venv\Scripts\python.exe"

REM Do not use activate.bat — use venv python.exe directly (works with non-ASCII paths)
"%VPY%" -m pip install -q --upgrade pip setuptools wheel
if errorlevel 1 (
  echo ERROR: Failed to upgrade pip/setuptools/wheel in .venv
  exit /b 1
)

"%VPY%" -m pip install -q -r requirements.txt
if errorlevel 1 (
  echo ERROR: Failed to install Python dependencies from backend\requirements.txt
  echo If psycopg2-binary fails to build, use Python 3.11/3.12 or install PostgreSQL tools (pg_config).
  exit /b 1
)

if not exist .env (
  if exist .env.example (
    echo Copying .env from .env.example — edit DATABASE_URL if PostgreSQL is not on localhost:5432
    copy /y .env.example .env >nul
  ) else (
    echo ERROR: backend\.env missing. Create it manually.
    exit /b 1
  )
)

echo.
echo Starting API: http://127.0.0.1:8000  docs: /docs
echo If startup fails with "connection refused": start PostgreSQL or run: docker compose up -d
echo.

"%VPY%" app.py
exit /b %ERRORLEVEL%
