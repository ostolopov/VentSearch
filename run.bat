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
set "PIP_DISABLE_PIP_VERSION_CHECK=1"
"%VPY%" -m pip install -q -r requirements.txt

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
set "LAN_IP="
for /f "usebackq delims=" %%I in (`powershell -NoProfile -Command "$ip=(Get-NetIPAddress -AddressFamily IPv4 ^| Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.PrefixOrigin -ne 'WellKnown' } ^| Select-Object -First 1 -ExpandProperty IPAddress); if($ip){$ip}"`) do (
  set "LAN_IP=%%I"
)
if defined LAN_IP (
  echo Local network URL: http://%LAN_IP%:8000/
) else (
  echo Local network URL: http://^<PC_IP^>:8000/
)
echo If startup fails with "connection refused": start PostgreSQL or run: docker compose up -d
echo.

"%VPY%" app.py
exit /b %ERRORLEVEL%
