"""
Сценарий: получить один вентилятор по id, модели или slug.

Поддерживает два способа идентификации: числовой id из CSV и имя/slug модели.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from domain.interfaces.product_repository import AbstractProductRepository


class ProductNotFoundError(Exception):
    """Вентилятор с заданным идентификатором не найден в каталоге."""


class GetProductUseCase:
    """
    Получить карточку вентилятора по любому из трёх идентификаторов:
    - числовой id (из CSV),
    - точное имя модели (регистронезависимо),
    - slug модели (_meta.model_slug).
    """

    def __init__(self, product_repo: AbstractProductRepository) -> None:
        self._repo = product_repo

    def execute(self, id_or_model: str, slug: str) -> Dict[str, Any]:
        """
        Найти вентилятор.

        :param id_or_model: нормализованная строка идентификатора (strip, whitespace collapsed).
        :param slug: slug-версия идентификатора для поиска по model_slug.
        :raises ProductNotFoundError: если вентилятор не найден ни по одному ключу.
        """
        product: Optional[Dict[str, Any]] = (
            self._repo.get_by_id(id_or_model)
            or self._repo.get_by_model_or_slug(id_or_model.lower(), slug)
        )
        if not product:
            raise ProductNotFoundError(f"Product not found: {id_or_model!r}")
        return product
