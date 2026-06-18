from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ProductionProcessStageCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=180)
    description: str | None = Field(default=None, max_length=1000)
    order: int = Field(ge=1)
    estimated_minutes: int | None = Field(default=None, ge=1)
    requires_weighing: bool = False
    is_active: bool = True


class ProductionProcessCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=180)
    description: str | None = Field(default=None, max_length=1000)
    version: int = Field(default=1, ge=1)
    is_active: bool = True
    stages: list[ProductionProcessStageCreate] = Field(min_length=1)


class ProductionProcessUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=180)
    description: str | None = Field(default=None, max_length=1000)
    version: int = Field(default=1, ge=1)
    is_active: bool = True
    stages: list[ProductionProcessStageCreate] = Field(min_length=1)


class ProductionProcessStageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: UUID
    name: str
    description: str | None = None
    stage_order: int
    estimated_minutes: int | None = None
    requires_weighing: bool
    is_active: bool


class ProductionProcessRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: UUID
    name: str
    description: str | None = None
    version: int
    is_active: bool
    stages: list[ProductionProcessStageRead] = Field(default_factory=list)
