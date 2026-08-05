from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


InventoryItemType = Literal["RAW_MATERIAL", "SUPPLY", "COMPLEMENT", "WORK_IN_PROGRESS", "FINISHED_PRODUCT", "WASTE"]
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
    "RECLASIFICACION_SALIDA",
    "RECLASIFICACION_ENTRADA",
]


class ComplementTypeCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=120)


class ComplementTypeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: UUID
    name: str
    is_active: bool


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
    # Tipo de complemento: solo aplica a items COMPLEMENT; el servicio lo
    # ignora para el resto de tipos.
    complement_type_id: UUID | None = None


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
    # PESO FINAL por pieza en gramos (real, con merma; nunca el planificado
    # de materia prima). Para las piezas pre-sistema se cargará desde el
    # Excel de la empresa. Solo se toca si viene en el payload: los
    # formularios que no lo envían no lo borran.
    weight_per_unit: Decimal | None = Field(default=None, gt=0)
    # Tipo de complemento: solo aplica a items COMPLEMENT; el servicio lo
    # ignora para el resto de tipos.
    complement_type_id: UUID | None = None


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
    # PESO FINAL por pieza en gramos: real de producción (merma incluida) en
    # piezas nacidas por conversión, o el cargado del histórico de la empresa.
    weight_per_unit: Decimal | None = None
    elaboration_date: date | None = None
    unit_code: str
    minimum_stock: Decimal | None = None
    current_stock: Decimal
    average_cost: Decimal = Decimal("0")
    archived_at: datetime | None = None
    complement_type_id: UUID | None = None


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
    # Pureza del resultado: derivada de la pieza con más gramos (editable).
    purity: str | None = Field(default=None, max_length=40)


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


class WaitingProductionRunSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    run_id: UUID
    production_code: str | None = None
    root_production_code: str | None = None
    process_name: str | None = None
    missing_quantity: Decimal


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
    # Ordenes ESPERANDO_MATERIAL de esta materia prima: se llena solo en la
    # respuesta de un ENTRADA, para que el frontend ofrezca "destinar".
    waiting_production_runs: list[WaitingProductionRunSummary] = Field(default_factory=list)


class InventorySummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    raw_materials: int
    supplies: int
    complements: int
    work_in_progress: int
    finished_products: int
    low_stock_items: int
    total_items: int
