from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class StageIngredientCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    inventory_item_id: UUID
    quantity: Decimal = Field(gt=0)
    unit_code: str = Field(max_length=20)


class StageIngredientRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: UUID
    inventory_item_id: UUID
    quantity: Decimal
    unit_code: str


class ProcessMaterialCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    inventory_item_id: UUID
    quantity_per_unit: Decimal = Field(gt=0)
    unit_code: str = Field(min_length=1, max_length=20)


class ProcessMaterialRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: UUID
    inventory_item_id: UUID
    quantity_per_unit: Decimal
    unit_code: str


class ProductionProcessStageCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=180)
    description: str | None = Field(default=None, max_length=1000)
    phase_name: str | None = Field(default=None, max_length=120)
    stage_type: str = Field(default="PROCESS", max_length=40)
    quality_check: str | None = Field(default=None, max_length=1000)
    rework_action: str | None = Field(default=None, max_length=1000)
    rework_target_order: int | None = Field(default=None, ge=1)
    order: int = Field(ge=1)
    requires_weighing: bool = False
    is_active: bool = True
    ingredients: list[StageIngredientCreate] = Field(default_factory=list)


class ProductionProcessCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=180)
    description: str | None = Field(default=None, max_length=1000)
    version: int = Field(default=1, ge=1)
    materials: list[ProcessMaterialCreate] = Field(min_length=1)
    waste_limit_percent: Decimal = Field(default=Decimal("1"), ge=0, le=100)
    is_active: bool = True
    stages: list[ProductionProcessStageCreate] = Field(min_length=1)
    # Tipos de producto del catalogo que este proceso puede producir (vacio = todos).
    product_type_ids: list[UUID] = Field(default_factory=list)


class ProductionProcessUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=180)
    description: str | None = Field(default=None, max_length=1000)
    version: int = Field(default=1, ge=1)
    materials: list[ProcessMaterialCreate] = Field(min_length=1)
    waste_limit_percent: Decimal = Field(default=Decimal("1"), ge=0, le=100)
    is_active: bool = True
    stages: list[ProductionProcessStageCreate] = Field(min_length=1)
    product_type_ids: list[UUID] = Field(default_factory=list)


class ProductionProcessStageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: UUID
    name: str
    description: str | None = None
    phase_name: str | None = None
    stage_type: str
    quality_check: str | None = None
    rework_action: str | None = None
    rework_target_order: int | None = None
    stage_order: int
    requires_weighing: bool
    is_active: bool
    ingredients: list[StageIngredientRead] = Field(default_factory=list)


class ProductionProcessRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: UUID
    name: str
    code: str | None = None
    description: str | None = None
    version: int
    materials: list[ProcessMaterialRead] = Field(default_factory=list)
    waste_limit_percent: Decimal
    is_active: bool
    stages: list[ProductionProcessStageRead] = Field(default_factory=list)
    product_type_ids: list[UUID] = Field(default_factory=list)


class ProductionRunCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    process_id: UUID
    # Material con el que se fabricara: debe ser uno de los configurados en el proceso.
    raw_material_item_id: UUID
    quantity: Decimal = Field(gt=0)


class MaterialRejectPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str | None = Field(default=None, max_length=1000)


class ProductionRunStageFinish(BaseModel):
    model_config = ConfigDict(extra="forbid")

    initial_weight: Decimal | None = Field(default=None, ge=0)
    final_weight: Decimal | None = Field(default=None, ge=0)
    decision: Literal["APPROVED", "REJECTED"] | None = None
    justification: str | None = Field(default=None, max_length=1000)


class StageDecisionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    decision: str
    justification: str | None = None
    weight_based: bool = False
    final_weight: Decimal | None = None
    returned_to_order: int | None = None
    decided_by_name: str | None = None
    decided_at: datetime
    attempt_no: int


class ProductionRunStageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: UUID
    source_stage_id: UUID
    stage_name: str
    stage_code: str | None = None
    phase_name: str | None = None
    stage_type: str
    quality_check: str | None = None
    rework_action: str | None = None
    rework_target_order: int | None = None
    stage_order: int
    requires_weighing: bool
    status: str
    scheduled_start_at: datetime | None = None
    scheduled_finish_at: datetime | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    initial_weight: Decimal | None = None
    final_weight: Decimal | None = None
    waste_weight: Decimal | None = None
    waste_percent: Decimal | None = None
    finished_by_name: str | None = None
    decisions: list[StageDecisionRead] = Field(default_factory=list)


class SupplyConsumptionRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    quantity: Decimal
    unit_code: str


class ProductionRunRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: UUID
    process_id: UUID
    process_name: str
    production_code: str | None = None
    quantity: Decimal
    status: str
    raw_material_item_id: UUID
    raw_material_quantity_per_unit: Decimal
    raw_material_unit_code: str
    total_required_material: Decimal
    waste_limit_percent: Decimal
    expected_finished_weight: Decimal
    actual_finished_weight: Decimal | None = None
    waste_weight: Decimal | None = None
    waste_percent: Decimal | None = None
    created_by_user_id: UUID
    created_by_name: str | None = None
    started_by_name: str | None = None
    materials_approved_by_name: str | None = None
    received_by_name: str | None = None
    rejected_by_name: str | None = None
    rejection_reason: str | None = None
    rejected_at: datetime | None = None
    requested_at: datetime
    materials_approved_at: datetime | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    received_at: datetime | None = None
    stages: list[ProductionRunStageRead] = Field(default_factory=list)
    # Tipos de producto que el proceso de esta orden puede producir (vacio = todos).
    # Gobierna el combo al convertir el lote en productos terminados.
    allowed_product_type_ids: list[UUID] = Field(default_factory=list)
    # Insumos realmente consumidos al aprobar materiales (desde los movimientos
    # de inventario de la orden). Alimenta el acta de entrega.
    supply_consumptions: list[SupplyConsumptionRead] = Field(default_factory=list)
