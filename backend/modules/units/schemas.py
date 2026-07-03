from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class UnitCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    # label = nombre (ej. "Gramos"); code = abreviatura mostrada (ej. "g").
    label: str = Field(min_length=1, max_length=120)
    code: str = Field(min_length=1, max_length=20)


class UnitRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: UUID
    code: str
    label: str
    is_active: bool = True
