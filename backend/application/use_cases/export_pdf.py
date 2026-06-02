"""
Сценарий: получить данные для PDF-экспорта сравнения.

Use case отвечает только за сбор продуктов по списку id.
Генерацию PDF (ReportLab) выполняет инфраструктурный/презентационный слой.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List

from domain.interfaces.product_repository import AbstractProductRepository
from application.use_cases.get_product import GetProductUseCase, ProductNotFoundError


class EmptyIdsError(Exception):
    """Список id для экспорта пуст."""


class ProductsNotFoundError(Exception):
    """Один или несколько продуктов из списка не найдены."""

    def __init__(self, missing: List[str]) -> None:
        self.missing = missing
        super().__init__(f"Products not found: {', '.join(missing)}")


@dataclass
class ExportPdfQuery:
    """Параметры запроса на экспорт."""

    ids: List[str] = field(default_factory=list)
    filename: str = "ventsearch-compare.pdf"


@dataclass
class ExportPdfResult:
    """Продукты, готовые к вёрстке PDF."""

    products: List[Dict[str, Any]]
    filename: str


class ExportPdfUseCase:
    """
    Собрать список продуктов по id для PDF-экспорта.

    Проверяет, что все id найдены; если нет — возбуждает ProductsNotFoundError.
    Не зависит от библиотеки ReportLab — только бизнес-логика выборки.
    """

    def __init__(self, product_repo: AbstractProductRepository) -> None:
        self._get_product = GetProductUseCase(product_repo)

    def execute(self, query: ExportPdfQuery) -> ExportPdfResult:
        if not query.ids:
            raise EmptyIdsError("ids must not be empty")

        products: List[Dict[str, Any]] = []
        missing: List[str] = []

        for raw_id in query.ids:
            try:
                slug = _slugify(raw_id)
                product = self._get_product.execute(raw_id, slug)
                products.append(product)
            except ProductNotFoundError:
                missing.append(raw_id)

        if missing:
            raise ProductsNotFoundError(missing)

        return ExportPdfResult(products=products, filename=query.filename)


def _slugify(value: str) -> str:
    import re
    s = " ".join(str(value).replace("\u00A0", " ").split()).lower()
    s = re.sub(r"[^\w]+", "-", s, flags=re.UNICODE)
    return re.sub(r"-{2,}", "-", s).strip("-")
