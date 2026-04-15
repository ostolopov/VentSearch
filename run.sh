#!/usr/bin/env bash
# Запуск API (macOS, Linux, Git Bash на Windows).
# В обычном «Командная строка» Windows используйте run.bat
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT/backend"

if command -v python3 >/dev/null 2>&1; then
  PY=python3
elif command -v python >/dev/null 2>&1; then
  PY=python
else
  echo "Не найден python3 или python. Установите Python 3.11+." >&2
  exit 1
fi

if [ ! -d .venv ]; then
  echo "Создаю виртуальное окружение .venv..."
  "$PY" -m venv .venv
fi

# shellcheck disable=SC1091
source .venv/bin/activate

python -m pip install -q -r requirements.txt

if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    echo "Копирую .env из .env.example (проверьте DATABASE_URL)."
    cp .env.example .env
  else
    echo "Нет файла backend/.env — создайте его вручную." >&2
    exit 1
  fi
fi

echo "Запуск API (порт см. PORT в backend/.env, по умолчанию 8000): http://127.0.0.1:8000/docs"
cd "$ROOT"
exec python -m backend.app