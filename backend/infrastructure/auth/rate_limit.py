"""
Ограничитель неудачных попыток входа (защита от перебора паролей).

Скользящее окно неудачных попыток на ключ (IP + email). После MAX_ATTEMPTS
неудач в течение WINDOW_SECONDS вход блокируется до «остывания» окна.
Хранение — в памяти процесса: для локального развёртывания в LAN
(один процесс uvicorn) этого достаточно; при переходе на несколько
воркеров лимитер нужно вынести в БД или Redis.

Зависимости: только стандартная библиотека.
"""
from __future__ import annotations

import threading
import time
from collections import deque
from typing import Deque, Dict

MAX_ATTEMPTS = 5
WINDOW_SECONDS = 15 * 60


class LoginRateLimiter:
    """Потокобезопасный лимитер по скользящему окну."""

    def __init__(self, max_attempts: int = MAX_ATTEMPTS, window_seconds: int = WINDOW_SECONDS) -> None:
        self.max_attempts = max_attempts
        self.window_seconds = window_seconds
        self._failures: Dict[str, Deque[float]] = {}
        self._lock = threading.Lock()

    def _prune(self, key: str, now: float) -> Deque[float]:
        attempts = self._failures.setdefault(key, deque())
        while attempts and now - attempts[0] > self.window_seconds:
            attempts.popleft()
        if not attempts:
            # не копим пустые ключи бесконечно
            self._failures.pop(key, None)
            attempts = self._failures.setdefault(key, deque())
        return attempts

    def seconds_until_allowed(self, key: str) -> int:
        """0 — вход разрешён; иначе через сколько секунд можно повторить."""
        now = time.monotonic()
        with self._lock:
            attempts = self._prune(key, now)
            if len(attempts) < self.max_attempts:
                return 0
            oldest = attempts[0]
            return max(1, int(self.window_seconds - (now - oldest)) + 1)

    def register_failure(self, key: str) -> None:
        now = time.monotonic()
        with self._lock:
            attempts = self._prune(key, now)
            attempts.append(now)

    def reset(self, key: str) -> None:
        """Успешный вход сбрасывает счётчик неудач."""
        with self._lock:
            self._failures.pop(key, None)

    def clear(self) -> None:
        """Полный сброс (используется в тестах)."""
        with self._lock:
            self._failures.clear()
