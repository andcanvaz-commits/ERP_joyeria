from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


InventoryItemType = Literal["RAW_MATERIAL", "SUPPLY", "WORK_IN_PROGRESS", "FINISHED_PRODUCT"]
InventoryMovementType = Literal[
    "ENTRADA",
    "SALIDA",
    "AJUSTE_POSITIVO",
    "AJUSTE_NEGATIVO",
    "CONSUMO_PRODUCCION",
    "INGRESO_PRODUCCION",
    "MERMA",
    "CONVERSION_SALIDA",
    "CONVERSION_ENTRADA",
]


class InventoryItemCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    item_type: InventoryItemType
    name: str = Field(min_length=1, max_length=180)
    description: str | None = Field(default=None, max_length=1000)
    material_type: str | None = Field(default=None, max_length=80)
    purity: str | None = Field(default=None, max_length=40)
    total_weight: Decimal | None = Field(default=None, ge=0)
    elaboration_date: date | None = None
    unit_code: str = Field(min_length=1, max_length=20)
    minimum_stock: Decimal | None = Field(default=None, ge=0)


class InventoryItemUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    item_type: InventoryItemType
    name: str = Field(min_length=1, max_length=180)
    description: str | None = Field(default=None, max_length=1000)
    material_type: str | None = Field(default=None, max_length=80)
    purity: str | None = Field(default=None, max_length=40)
    total_weight: Decimal | None = Field(default=None, ge=0)
    elaboration_date: date | None = None
    unit_code: str = Field(min_length=1, max_length=20)
    minimum_stock: Decimal | None = Field(default=None, ge=0)


class InventoryItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: UUID
    item_type: InventoryItemType
    name: str
    sku: str
    product_code: str | None = None
    source_lot_sku: str | None = None
    description: str | None = None
    material_type: str | None = None
    purity: str | None = None
    total_weight: Decimal | None = None
    # Gramos por unidad (solo piezas nacidas por conversión con el sistema).
    weight_per_unit: Decimal | None = None
    elaboration_date: date | None = None
    unit_code: str
    minimum_stock: Decimal | None = None
    current_stock: Decimal
    average_cost: Decimal = Decimal("0")
    archived_at: datetime | None = None


class LotConversionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Segmento del material para el código; si falta, el servicio lo resuelve
    # empatando el material de fabricación del lote contra el catálogo.
    material_code: str | None = Field(default=None, min_length=1, max_length=1)
    # Destino: una pieza existente del inventario (target_item_id) o un tipo
    # del catálogo (product_type_id, ej. producto recién creado). Uno de los dos.
    product_type_id: UUID | None = None
    target_item_id: UUID | None = None
    quantity: Decimal = Field(gt=0)
    # Material de la pieza: el de fabricación del lote (no editable en UI).
    material_type: str | None = Field(default=None, max_length=80)


class CombineSourceLine(BaseModel):
    model_config = ConfigDict(extra="forbid")

    item_id: UUID
    quantity: Decimal = Field(gt=0)


class ProductCombineCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sources: list[CombineSourceLine] = Field(min_length=2)
    material_code: str = Field(min_length=1, max_length=1)
    # Destino: una pieza existente del inventario (target_item_id) o un tipo
    # del catálogo (product_type_id, ej. producto recién creado). Uno de los dos.
    product_type_id: UUID | None = None
    target_item_id: UUID | None = None
    quantity: Decimal = Field(gt=0)
    # Texto libre del material del resultado (ej. "ORO 18K + PLATA 925"),
    # derivado de las piezas en el frontend pero editable por el usuario.
    material_type: str | None = Field(default=None, max_length=80)


class InventoryMovementCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    item_id: UUID
    movement_type: InventoryMovementType
    quantity: Decimal = Field(gt=0)
    unit_cost: Decimal | None = Field(default=None, ge=0)
    reason: str = Field(min_length=1, max_length=240)
    reference_type: str | None = Field(default=None, max_length=80)
    reference_id: UUID | None = None
    source_file_name: str | None = Field(default=None, max_length=240)
    source_file_mime: str | None = Field(default=None, max_length=120)
    source_file_content: str | None = Field(default=None, max_length=2_000_000)


class InventoryMovementRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: UUID
    item_id: UUID
    movement_type: InventoryMovementType
    quantity: Decimal
    unit_code: str
    unit_cost: Decimal | None = None
    lot_code: str | None = None
    reason: str
    reference_type: str | None = None
    reference_id: UUID | None = None
    source_file_name: str | None = None
    created_by: UUID | None = None
    created_by_name: str | None = None
    created_at: datetime
    item: InventoryItemRead


class InventorySummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    raw_materials: int
    supplies: int
    work_in_progress: int
    finished_products: int
    low_stock_items: int
    total_items: int
