from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

SegmentKind = Literal["MATERIAL", "CATEGORY", "MODEL"]


class CatalogSegmentCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: SegmentKind
    label: str = Field(min_length=1, max_length=180)
    parent_code: str | None = Field(default=None, max_length=10)
    code: str | None = Field(default=None, max_length=10)


class CatalogSegmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: UUID
    kind: str
    code: str
    label: str
    parent_code: str | None = None
    is_active: bool = True
