from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

MessageDecision = Literal["APROBADA", "RECHAZADA"]


class AdminMessageCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    body: str = Field(min_length=1, max_length=2000)


class AdminMessageReplyCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    decision: MessageDecision
    body: str | None = Field(default=None, max_length=2000)


class AdminMessageReplyRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: UUID
    sender_user_id: UUID
    sender_name: str | None = None
    decision: MessageDecision
    body: str | None = None
    created_at: datetime


class AdminMessageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: UUID
    sender_user_id: UUID
    sender_name: str | None = None
    body: str
    created_at: datetime
    replies: list[AdminMessageReplyRead] = []
