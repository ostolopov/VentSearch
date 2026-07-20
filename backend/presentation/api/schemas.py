"""
Pydantic-модели для OpenAPI: response_model и примеры ответов.

Слой: Presentation. Не импортируется из domain или infrastructure.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator


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
    nominal_rpm: Optional[float] = None
    pressure_coefficients: Optional[List[float]] = None
    efficiency_coefficients: Optional[List[float]] = None
    dimensions: Optional[Dict[str, str]] = Field(
        default=None,
        description="Габаритно-присоединительные размеры по чертежу завода (D, D1, d, n, L, ...)",
    )
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


class SelectPointItemOut(BaseModel):
    """Кандидат подбора по рабочей точке."""

    product: ProductOut
    p_available: float = Field(..., description="Давление на кривой Q-P при заданном расходе, Па")
    reserve_percent: float = Field(..., description="Запас давления относительно точки, %")


class SelectPointOut(BaseModel):
    """Результат подбора по рабочей точке (Q, P)."""

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "items": [],
                "total_considered": 12,
                "point": {"q": 5000, "p": 500},
            }
        }
    )

    items: List[SelectPointItemOut] = Field(default_factory=list)
    total_considered: int = Field(0, description="Сколько кандидатов покрыло точку по расходу")
    point: Dict[str, float] = Field(default_factory=dict, description="Эхо рабочей точки {q, p}")


class ProductFamilyOut(BaseModel):
    """Модельный ряд: одна аэродинамическая схема в разных типоразмерах."""

    key: str = Field(..., description="Модель без типоразмера в хвосте")
    type: str = ""
    variants: List[ProductOut] = Field(default_factory=list)


class ProductFamiliesOut(BaseModel):
    families: List[ProductFamilyOut] = Field(default_factory=list)


class HealthOut(BaseModel):
    model_config = ConfigDict(json_schema_extra={"example": {"ok": True, "products": 120}})

    ok: bool = True
    products: int = Field(..., description="Количество записей в таблице products")
    demo_mode: bool = Field(False, description="Инсайдерский/демо-режим — каталог скрыт для внешнего показа")


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


class AuthRegisterIn(BaseModel):
    email: str = Field(..., min_length=3, max_length=254)
    password: str = Field(..., min_length=6, max_length=128)
    name: str = Field(default="", max_length=200)
    company: str = Field(default="", max_length=200)
    phone: str = Field(default="", max_length=50)


class AuthLoginIn(BaseModel):
    email: str = Field(..., min_length=3, max_length=254)
    password: str = Field(..., min_length=1, max_length=128)


class UserOut(BaseModel):
    id: int
    email: str
    name: str = ""
    company: str = ""
    phone: str = ""
    role: str = "user"
    is_active: bool = True
    is_protected: bool = False
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class AuthTokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class UserListPageOut(BaseModel):
    items: List[UserOut] = Field(default_factory=list)
    total: int
    limit: int
    offset: int


class AdminUserIn(BaseModel):
    email: str = Field(..., min_length=3, max_length=254)
    password: str = Field(..., min_length=6, max_length=128)
    name: str = Field(default="", max_length=200)
    company: str = Field(default="", max_length=200)
    phone: str = Field(default="", max_length=50)
    role: str = Field(default="user", pattern="^(user|admin)$")


class AdminUserUpdateIn(BaseModel):
    email: Optional[str] = Field(default=None, max_length=254)
    password: Optional[str] = Field(default=None, min_length=6, max_length=128)
    name: Optional[str] = Field(default=None, max_length=200)
    company: Optional[str] = Field(default=None, max_length=200)
    phone: Optional[str] = Field(default=None, max_length=50)
    role: Optional[str] = Field(default=None, pattern="^(user|admin)$")
    is_active: Optional[bool] = None


class BulkDeleteProductsIn(BaseModel):
    ids: List[str] = Field(..., min_length=1, max_length=500)


class BulkDeleteUsersIn(BaseModel):
    ids: List[int] = Field(..., min_length=1, max_length=500)


class BulkDeleteOut(BaseModel):
    deleted: int = Field(..., ge=0)
    errors: List[dict] = Field(default_factory=list)


class AdminProductIn(BaseModel):
    id: str = Field(..., min_length=1, max_length=64)
    number: str = Field(default="", max_length=64)
    type: str = Field(default="", max_length=64)
    model: str = Field(default="", max_length=256)
    size: str = Field(default="", max_length=256)
    diameter: Optional[float] = None
    airflow_min: Optional[float] = None
    airflow_max: Optional[float] = None
    airflow_raw: str = ""
    pressure_min: Optional[float] = None
    pressure_max: Optional[float] = None
    pressure_raw: str = ""
    power: Optional[float] = None
    noise_level: Optional[float] = None
    price: Optional[float] = None
    raw_diameter: str = ""
    raw_efficiency: str = ""
    raw_pressure: str = ""
    raw_power: str = ""
    raw_noise_level: str = ""
    raw_price: str = ""
    model_slug: str = ""

    @model_validator(mode="after")
    def _check_ranges(self) -> "AdminProductIn":
        # π₁: Q_min ≤ Q_max — расход растёт монотонно, это универсальный
        # арифметический минимум/максимум, инверсия всегда ошибка.
        if (
            self.airflow_min is not None
            and self.airflow_max is not None
            and self.airflow_min > self.airflow_max
        ):
            raise ValueError(
                f"Расход: минимум ({self.airflow_min}) не может быть больше максимума ({self.airflow_max})"
            )
        # Давление НЕ проверяем на min ≤ max: pressure_min/pressure_max в этом
        # каталоге означают «давление при Q_min» / «давление при Q_max», а не
        # арифметические границы — у вентилятора давление обычно падает с
        # ростом расхода, поэтому pressure_min > pressure_max является нормой
        # (см. build_qp_curve, который явно берёт max()/min() из этой пары).
        # π₃, π₄: отрицательные и нулевые границы — всегда ошибка независимо
        # от того, как называется поле.
        for label, value in (
            ("Расход (мин)", self.airflow_min),
            ("Расход (макс)", self.airflow_max),
            ("Давление (мин)", self.pressure_min),
            ("Давление (макс)", self.pressure_max),
        ):
            if value is not None and value <= 0:
                raise ValueError(f"{label}: значение должно быть больше нуля (сейчас {value})")
        return self


class PdfExportRequest(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "ids": ["3037", "3038", "3039"],
                "filename": "ventmash-compare.pdf",
                "chart_image_data_url": "data:image/png;base64,...",
            }
        }
    )

    ids: List[str] = Field(
        ...,
        min_length=1,
        max_length=20,
        description="Список id/моделей для включения в PDF (1-20 элементов).",
    )
    filename: Optional[str] = Field(
        default=None,
        description="Имя файла для скачивания (опционально, без пути).",
    )
    chart_image_data_url: Optional[str] = Field(
        default=None,
        description="PNG-график из canvas в формате data URL (опционально).",
    )
    header_text: Optional[str] = Field(
        default=None,
        max_length=120,
        description="Свой текст в шапке PDF. Пусто — остаётся текст по умолчанию.",
    )
    watermark: Optional[str] = Field(
        default=None,
        description="Имя файла водяного знака из папки photos/ (опционально, без пути).",
    )
    show_title: bool = Field(
        default=False,
        description="Показывать заголовок (синяя плашка с названием отчёта и датой) в PDF.",
    )
    letterhead: bool = Field(
        default=False,
        description="Показывать фирменную шапку (бланк заказчика) сверху каждой страницы PDF.",
    )
