"""
Сценарий: группировка вентиляторов в "модельный ряд".

Одна аэродинамическая схема (число лопастей, угол атаки) выпускается в
нескольких типоразмерах — как один дизайн, масштабированный под разный
расход/давление. Ключ ряда — модель без типоразмера в хвосте
(«ВО 13-284-4/15°-456A4» → «ВО 13-284-4/15°»), внутри ряда варианты
отсортированы по диаметру.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List

from domain.interfaces.product_repository import AbstractProductRepository


def family_key(model: str | None, size: str | None) -> str:
    """Ключ модельного ряда: модель без суффикса-типоразмера."""
    model = (model or "").strip()
    size = (size or "").strip()
    if model and size and model.lower().endswith(f"-{size.lower()}"):
        return model[: -(len(size) + 1)].strip()
    return model


@dataclass
class ProductFamily:
    key: str
    type: str
    variants: List[Dict[str, Any]] = field(default_factory=list)


class ListProductFamiliesUseCase:
    """Группировка всего каталога по модельному ряду."""

    def __init__(self, product_repo: AbstractProductRepository) -> None:
        self._repo = product_repo

    def execute(self) -> List[ProductFamily]:
        products = self._repo.fetch_all()

        groups: Dict[str, ProductFamily] = {}
        order: List[str] = []
        for p in products:
            key = family_key(p.get("model"), p.get("size"))
            if key not in groups:
                groups[key] = ProductFamily(key=key, type=p.get("type") or "")
                order.append(key)
            groups[key].variants.append(p)

        families = [groups[k] for k in order]
        for fam in families:
            fam.variants.sort(key=lambda p: (p.get("diameter") or 0, p.get("id") or ""))
        return families
