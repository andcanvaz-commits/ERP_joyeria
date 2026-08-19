from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class AdminMessageCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    body: str = Field(min_length=1, max_length=2000)


class AdminMessageRespond(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["ACEPTADA", "RECHAZADA"]


class AdminMessageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: UUID
    sender_user_id: UUID
    sender_name: str | None = None
    body: str
    status: str
    created_at: datetime
    responded_by_user_id: UUID | None = None
    responded_by_name: str | None = None
    responded_at: datetime | None = None
