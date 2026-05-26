#!/usr/bin/env bash
# Запуск API локально без Docker (macOS / Linux / Git Bash на Windows).
# Для Windows CMD: deploy\run.bat
#
# Запуск из корня репозитория:
#   bash deploy/run.sh
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DEPLOY_DIR/.." && pwd)"
BACKEND_DIR="$ROOT/backend"
SECRETS_LOCAL="$ROOT/secrets/.env.local"
SECRETS_EXAMPLE="$ROOT/secrets/.env.local.example"

# --- Проверяем secrets/.env.local ---
if [ ! -f "$SECRETS_LOCAL" ]; then
  if [ -f "$SECRETS_EXAMPLE" ]; then
    echo "Создаю secrets/.env.local из шаблона secrets/.env.local.example"
    echo "Проверьте DATABASE_URL и другие параметры перед первым запуском."
    cp "$SECRETS_EXAMPLE" "$SECRETS_LOCAL"
  else
    echo "ОШИБКА: нет файла secrets/.env.local" >&2
    echo "Создайте его: cp secrets/.env.local.example secrets/.env.local" >&2
    exit 1
  fi
fi

# --- Python ---
if command -v python3 >/dev/null 2>&1; then
  PY=python3
elif command -v python >/dev/null 2>&1; then
  PY=python
else
  echo "ОШИБКА: python3 не найден. Установите Python 3.11+." >&2
  exit 1
fi

# --- Виртуальное окружение ---
cd "$BACKEND_DIR"
if [ ! -d .venv ]; then
  echo "Создаю виртуальное окружение backend/.venv ..."
  "$PY" -m venv .venv
fi

# shellcheck disable=SC1091
source .venv/bin/activate
export PIP_DISABLE_PIP_VERSION_CHECK=1
python -m pip install -q -r requirements.txt

# --- LAN IP для удобства ---
LAN_IP="$("$PY" - <<'PY'
import socket
try:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.connect(("8.8.8.8", 80))
    ip = s.getsockname()[0]
    s.close()
    if not ip.startswith("127."):
        print(ip)
except Exception:
    pass
PY
)"

echo ""
echo "Секреты: secrets/.env.local"
echo "API:     http://127.0.0.1:8000/docs"
if [ -n "${LAN_IP:-}" ]; then
  echo "Сеть:    http://${LAN_IP}:8000/"
fi
echo ""
exec python app.py
