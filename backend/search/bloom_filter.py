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
        b = item.encode("utf-8")
        out: list[int] = []
        for i in range(self._k):
            person = bytearray(16)
            person[0:2] = i.to_bytes(2, "big")
            h = hashlib.blake2b(b, digest_size=8, person=bytes(person)).digest()
            out.append(int.from_bytes(h, "big") % self._m)
        return out

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
        """False — значения точно нет в множестве; True — может быть (возможен ложный положительный)."""
        return all(self._get_bit(p) for p in self._positions(item))
