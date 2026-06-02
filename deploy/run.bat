@echo off
rem Запуск API локально без Docker (Windows CMD).
rem Запуск из корня репозитория: deploy\run.bat
setlocal

rem Определяем корень репозитория (папка выше deploy\)
set "ROOT=%~dp0.."
set "SECRETS_LOCAL=%ROOT%\secrets\.env.local"
set "SECRETS_EXAMPLE=%ROOT%\secrets\.env.local.example"

rem --- Проверяем secrets\.env.local ---
if not exist "%SECRETS_LOCAL%" (
  if exist "%SECRETS_EXAMPLE%" (
    echo Создаю secrets\.env.local из шаблона secrets\.env.local.example
    echo Проверьте DATABASE_URL и другие параметры перед первым запуском.
    copy /y "%SECRETS_EXAMPLE%" "%SECRETS_LOCAL%" >nul
  ) else (
    echo ОШИБКА: нет файла secrets\.env.local
    echo Создайте его: copy secrets\.env.local.example secrets\.env.local
    exit /b 1
  )
)

rem --- Переходим в backend ---
cd /d "%ROOT%\backend"

where python >nul 2>&1
if errorlevel 1 (
  echo ОШИБКА: Python не найден в PATH. Установите Python 3.11+.
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo Создаю виртуальное окружение backend\.venv ...
  python -m venv .venv
)

if not exist ".venv\Scripts\python.exe" (
  echo ОШИБКА: не удалось создать .venv
  exit /b 1
)

set "VPY=%CD%\.venv\Scripts\python.exe"
set "PIP_DISABLE_PIP_VERSION_CHECK=1"
"%VPY%" -m pip install -q -r requirements.txt

rem --- LAN IP ---
set "LAN_IP="
for /f "usebackq delims=" %%I in (`powershell -NoProfile -Command "$ip=(Get-NetIPAddress -AddressFamily IPv4 ^| Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.PrefixOrigin -ne 'WellKnown' } ^| Select-Object -First 1 -ExpandProperty IPAddress); if($ip){$ip}"`) do (
  set "LAN_IP=%%I"
)

echo.
echo Секреты: secrets\.env.local
echo API:     http://127.0.0.1:8000/docs
if defined LAN_IP (
  echo Сеть:    http://%LAN_IP%:8000/
)
echo.

"%VPY%" app.py
exit /b %ERRORLEVEL%
