from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ProductTypeCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category_code: str = Field(min_length=1, max_length=10)
    model_code: str = Field(min_length=1, max_length=10)
    raw_material_item_id: UUID


class ProductTypeRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: UUID
    category_code: str
    model_code: str
    product_code: str
    category_label: str
    model_label: str
    raw_material_item_id: UUID
    raw_material_name: str
    purity: str | None = None
    is_active: bool = True
