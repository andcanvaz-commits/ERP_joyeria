from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ProductTypeCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category_code: str = Field(min_length=1, max_length=10)
    # Opcional: sin él, el sistema asigna el siguiente código de modelo libre
    # dentro del tipo y crea el segmento MODEL con el nombre del producto.
    model_code: str | None = Field(default=None, min_length=1, max_length=10)
    name: str = Field(min_length=1, max_length=180)
    price: Decimal | None = Field(default=None, ge=0)


class ProductTypeRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: UUID
    category_code: str
    model_code: str
    name: str | None = None
    price: Decimal | None = None
    category_label: str
    model_label: str
    is_active: bool = True
