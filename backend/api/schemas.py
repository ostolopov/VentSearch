"""
Pydantic-модели для OpenAPI: response_model и примеры ответов.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field


class RangeOut(BaseModel):
    model_config = ConfigDict(json_schema_extra={"example": {"min": 900, "max": 3600, "raw": "900 - 3600"}})

    min: Optional[float] = None
    max: Optional[float] = None
    raw: str = ""


class QPPointOut(BaseModel):
    """Точка на графике Q–P (расход–давление)."""

    model_config = ConfigDict(json_schema_extra={"example": {"q": 1000, "p": 250}})

    q: float = Field(..., description="Расход воздуха (Q), м³/ч")
    p: float = Field(..., description="Давление (P), Па")


class ProductRawOut(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "diameter": "400",
                "efficiency": "900 - 3600",
                "pressure": "30 - 170",
                "power": "180",
                "noise_level": "82",
                "price": "18 500",
            }
        }
    )

    diameter: str = ""
    efficiency: str = ""
    pressure: str = ""
    power: str = ""
    noise_level: str = ""
    price: str = ""


class ProductMetaOut(BaseModel):
    model_config = ConfigDict(json_schema_extra={"example": {"model_slug": "vo-30-160-040-1"}})

    model_slug: str = ""


class ProductListPageOut(BaseModel):
    """Страница списка вентиляторов с общим количеством по фильтрам."""

    model_config = ConfigDict(
        json_schema_extra={"example": {"items": [], "total": 0, "limit": 48, "offset": 0}}
    )

    items: List[ProductOut] = Field(default_factory=list, description="Строки текущей страницы")
    total: int = Field(..., description="Число позиций по текущим фильтрам (все страницы)")
    limit: int = Field(..., description="Запрошенный размер страницы")
    offset: int = Field(..., description="Смещение от начала отсортированного списка")


class CatalogFacetsOut(BaseModel):
    """Уникальные значения для выпадающих фильтров (без загрузки всего каталога)."""

    model_config = ConfigDict(
        json_schema_extra={"example": {"types": ["ВО", "ВК"], "diameters": [315.0, 400.0]}}
    )

    types: List[str] = Field(default_factory=list)
    diameters: List[float] = Field(default_factory=list)


class ProductOut(BaseModel):
    """Вентилятор в ответе API (совместимо с текущим JSON фронтенда)."""

    model_config = ConfigDict(
        populate_by_name=True,
        ser_json_by_alias=True,
        json_schema_extra={
            "example": {
                "id": "1",
                "number": "1",
                "type": "ВО",
                "model": "ВО 30-160-040-1",
                "size": "ВО 30-160-040",
                "diameter": 400,
                "airflow": {"min": 900, "max": 3600, "raw": "900 - 3600"},
                "pressure": {"min": 30, "max": 170, "raw": "30 - 170"},
                "power": 180,
                "noise_level": 82,
                "price": 18500,
                "_raw": {},
                "_meta": {"model_slug": "vo-30-160-040-1"},
            }
        },
    )

    id: str
    number: str
    type: str = Field(default="", description="Тип вентилятора (из CSV)")
    model: str = Field(default="", description="Полное название модели")
    size: str = Field(default="", description="Типоразмер")
    diameter: Optional[float] = None
    airflow: RangeOut
    pressure: RangeOut
    power: Optional[float] = None
    noise_level: Optional[float] = None
    price: Optional[float] = None
    raw_csv: Dict[str, str] = Field(
        default_factory=dict,
        alias="_raw",
        description="Исходные строковые значения из CSV",
    )
    meta: Dict[str, Any] = Field(
        default_factory=dict,
        alias="_meta",
        description="Служебные поля (slug и т.п.)",
    )


class HealthOut(BaseModel):
    model_config = ConfigDict(json_schema_extra={"example": {"ok": True, "products": 120}})

    ok: bool = True
    products: int = Field(..., description="Количество записей в таблице products")


class ErrorOut(BaseModel):
    model_config = ConfigDict(json_schema_extra={"example": {"error": "Product not found"}})

    error: str = Field(..., description="Краткое описание ошибки")


class HTTPValidationErrorDetail(BaseModel):
    loc: List[Any] = Field(default_factory=list)
    msg: str = ""
    type: str = ""


class HTTPValidationErrorOut(BaseModel):
    """Стандартная структура 422 в FastAPI (упрощённо для OpenAPI)."""

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "detail": [
                    {"loc": ["query", "sort"], "msg": "unexpected value", "type": "value_error"}
                ]
            }
        }
    )

    detail: List[HTTPValidationErrorDetail] | List[Dict[str, Any]] = Field(
        default_factory=list,
        description="Список ошибок валидации параметров",
    )
