"""
Bloom filter: быстрая предварительная проверка категориальных значений.
«Точно нет» — отсекаем без обращения к полным данным; «возможно да» — нужна точная проверка.
"""
import hashlib
import math
from typing import Iterable


class BloomFilter:
    def __init__(self, expected_items: int = 256, false_positive_rate: float = 0.01) -> None:
        if expected_items < 1:
            expected_items = 1
        ln2 = math.log(2)
        m = -expected_items * math.log(false_positive_rate) / (ln2**2)
        self._m = max(64, int(m))
        k = int((self._m / expected_items) * ln2) + 1
        self._k = max(1, min(k, 16))
        self._bytes = bytearray((self._m + 7) // 8)

    def _positions(self, item: str) -> list[int]:
        # Двойное хэширование (Кирш-Митценмахер): k позиций из ОДНОГО вызова
        # blake2b — pos_i = (h1 + i·h2) mod m. Свойства (вероятность ложных
        # срабатываний) те же, что у k независимых хэшей, но в ~k раз быстрее:
        # раньше на каждый запрос считалось до 16 отдельных digest'ов.
        h = hashlib.blake2b(item.encode("utf-8"), digest_size=16).digest()
        h1 = int.from_bytes(h[:8], "big")
        h2 = int.from_bytes(h[8:], "big") | 1  # нечётное — обходит весь диапазон mod m
        m = self._m
        return [(h1 + i * h2) % m for i in range(self._k)]

    def _set_bit(self, pos: int) -> None:
        self._bytes[pos // 8] |= 1 << (pos % 8)

    def _get_bit(self, pos: int) -> bool:
        return bool(self._bytes[pos // 8] & (1 << (pos % 8)))

    def add(self, item: str) -> None:
        for p in self._positions(item):
            self._set_bit(p)

    def add_many(self, items: Iterable[str]) -> None:
        for x in items:
            if x:
                self.add(x)

    def might_contain(self, item: str) -> bool:
        """False — значения точно нет в множестве; True — возможен ложный положительный."""
        return all(self._get_bit(p) for p in self._positions(item))

    def stats(self) -> dict:
        """Состояние битовой карты для отладочной визуализации (админ-панель)."""
        bits = [1 if self._get_bit(i) else 0 for i in range(self._m)]
        bits_set = sum(bits)
        return {
            "m": self._m,
            "k": self._k,
            "bits_set": bits_set,
            "fill_ratio": round(bits_set / self._m, 4) if self._m else 0.0,
            "bits": bits,
        }
