from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ProcessStageSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_stage_id: UUID
    name: str = Field(min_length=1, max_length=180)
    description: str | None = None
    order: int = Field(ge=1)
    estimated_minutes: int | None = Field(default=None, ge=1)
    requires_initial_weight: bool = False
    requires_final_weight: bool = False
    allows_waste: bool = False
    requires_observation: bool = False
    is_required: bool = True


class ProcessTemplateStageCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=180)
    description: str | None = Field(default=None, max_length=1000)
    order: int = Field(ge=1)
    estimated_minutes: int | None = Field(default=None, ge=1)
    requires_initial_weight: bool = False
    requires_final_weight: bool = False
    allows_waste: bool = False
    requires_observation: bool = False
    is_required: bool = True
    is_active: bool = True


class ProcessTemplateCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=180)
    description: str | None = Field(default=None, max_length=1000)
    product_id: UUID | None = None
    version: int = Field(default=1, ge=1)
    is_active: bool = True
    stages: list[ProcessTemplateStageCreate] = Field(min_length=1)


class ProcessTemplateStageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: UUID
    name: str
    description: str | None = None
    stage_order: int
    estimated_minutes: int | None = None
    requires_initial_weight: bool
    requires_final_weight: bool
    allows_waste: bool
    requires_observation: bool
    is_required: bool
    is_active: bool


class ProcessTemplateRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: UUID
    product_id: UUID | None = None
    name: str
    description: str | None = None
    version: int
    is_active: bool
    stages: list[ProcessTemplateStageRead] = Field(default_factory=list)


class ProductionOrderCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_id: UUID
    quantity: Decimal = Field(gt=0, max_digits=14, decimal_places=4)
    process_template_id: UUID
    notes: str | None = Field(default=None, max_length=1000)


class ProductionOrderStageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: UUID
    source_stage_id: UUID
    stage_name: str
    stage_description: str | None = None
    stage_order: int
    estimated_minutes: int | None = None
    requires_initial_weight: bool
    requires_final_weight: bool
    allows_waste: bool
    requires_observation: bool
    is_required: bool
    status: str
    initial_weight: Decimal | None = None
    final_weight: Decimal | None = None
    waste_weight: Decimal | None = None
    observations: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None


class ProductionOrderRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: UUID
    product_id: UUID
    process_template_id: UUID
    quantity: Decimal
    status: str
    process_snapshot: dict
    notes: str | None = None
    created_by_user_id: UUID
    started_by_user_id: UUID | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    stages: list[ProductionOrderStageRead] = Field(default_factory=list)


class ProductionStageStart(BaseModel):
    model_config = ConfigDict(extra="forbid")

    initial_weight: Decimal | None = Field(default=None, gt=0, max_digits=14, decimal_places=4)
    observations: str | None = Field(default=None, max_length=1000)


class ProductionStageFinish(BaseModel):
    model_config = ConfigDict(extra="forbid")

    final_weight: Decimal | None = Field(default=None, gt=0, max_digits=14, decimal_places=4)
    waste_weight: Decimal | None = Field(default=None, ge=0, max_digits=14, decimal_places=4)
    observations: str | None = Field(default=None, max_length=1000)
