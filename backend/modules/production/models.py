from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from uuid import UUID as PyUUID, uuid4

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.modules.database.base import Base


class ProductionOrderStatus(StrEnum):
    DRAFT = "BORRADOR"
    PENDING = "PENDIENTE"
    IN_PROGRESS = "EN_PROCESO"
    PAUSED = "PAUSADA"
    FINISHED = "FINALIZADA"
    CANCELLED = "CANCELADA"


class ProductionStageStatus(StrEnum):
    PENDING = "PENDIENTE"
    IN_PROGRESS = "EN_PROCESO"
    FINISHED = "FINALIZADA"
    SKIPPED = "OMITIDA"


class ProductionOrder(Base):
    __tablename__ = "production_orders"

    id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    product_id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    process_template_id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 4), nullable=False)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default=ProductionOrderStatus.DRAFT)
    process_snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    started_by_user_id: Mapped[PyUUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    stages: Mapped[list["ProductionOrderStage"]] = relationship(
        back_populates="order",
        cascade="all, delete-orphan",
        order_by="ProductionOrderStage.stage_order",
    )


class ProductionOrderStage(Base):
    __tablename__ = "production_order_stages"

    id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    order_id: Mapped[PyUUID] = mapped_column(ForeignKey("production_orders.id"), nullable=False)
    source_stage_id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    stage_name: Mapped[str] = mapped_column(String(180), nullable=False)
    stage_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    stage_order: Mapped[int] = mapped_column(Integer, nullable=False)
    estimated_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    requires_initial_weight: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    requires_final_weight: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    allows_waste: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    requires_observation: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default=ProductionStageStatus.PENDING)
    initial_weight: Mapped[Decimal | None] = mapped_column(Numeric(14, 4), nullable=True)
    final_weight: Mapped[Decimal | None] = mapped_column(Numeric(14, 4), nullable=True)
    waste_weight: Mapped[Decimal | None] = mapped_column(Numeric(14, 4), nullable=True)
    observations: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    order: Mapped[ProductionOrder] = relationship(back_populates="stages")
