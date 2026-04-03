"""
Отсортированные индексы для числовых полей: поиск диапазона через bisect (логика B-tree / упорядоченный индекс).
"""
import bisect
from typing import Callable, List, Optional, Set, Tuple

Pair = Tuple[float, str]


class SortedRangeIndex:
    """Пары (значение, id), отсортированные по значению; один id может встречаться один раз на ось."""

    __slots__ = ("_pairs", "_keys")

    def __init__(self, pairs: List[Pair], key: Callable[[Pair], float] | None = None) -> None:
        self._pairs = sorted(pairs, key=key or (lambda p: p[0]))
        self._keys = [p[0] for p in self._pairs]

    def ids_in_range(
        self,
        min_v: Optional[float] = None,
        max_v: Optional[float] = None,
    ) -> Set[str]:
        """Идентификаторы записей, у которых значение попадает в [min_v, max_v] (границы включительно)."""
        if not self._pairs:
            return set()
        lo = float("-inf") if min_v is None else min_v
        hi = float("inf") if max_v is None else max_v
        i = bisect.bisect_left(self._keys, lo)
        j = bisect.bisect_right(self._keys, hi)
        return {self._pairs[k][1] for k in range(i, j)}
