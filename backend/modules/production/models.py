from datetime import datetime
from decimal import Decimal
from uuid import UUID as PyUUID, uuid4

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.modules.database.base import Base


class ProductionProcess(Base):
    __tablename__ = "production_processes"

    id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    raw_material_item_id: Mapped[PyUUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    raw_material_quantity_per_unit: Mapped[Decimal | None] = mapped_column(Numeric(14, 4), nullable=True)
    raw_material_unit_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    waste_limit_percent: Mapped[Decimal] = mapped_column(Numeric(7, 4), nullable=False, default=Decimal("5"))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    stages: Mapped[list["ProductionProcessStage"]] = relationship(
        back_populates="process",
        cascade="all, delete-orphan",
        order_by="ProductionProcessStage.stage_order",
    )


class ProductionProcessStage(Base):
    __tablename__ = "production_process_stages"

    id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    process_id: Mapped[PyUUID] = mapped_column(
        ForeignKey("production_processes.id"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    stage_order: Mapped[int] = mapped_column(Integer, nullable=False)
    estimated_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    requires_weighing: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    process: Mapped[ProductionProcess] = relationship(back_populates="stages")


class ProductionRunStatus:
    IN_PROGRESS = "EN_PROCESO"
    FINISHED = "FINALIZADA"
    CANCELLED = "CANCELADA"


class ProductionRunStageStatus:
    PENDING = "PENDIENTE"
    IN_PROGRESS = "EN_PROCESO"
    FINISHED = "FINALIZADA"


class ProductionRun(Base):
    __tablename__ = "production_runs"

    id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    process_id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    process_name: Mapped[str] = mapped_column(String(180), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 4), nullable=False)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default=ProductionRunStatus.IN_PROGRESS)
    raw_material_item_id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    raw_material_quantity_per_unit: Mapped[Decimal] = mapped_column(Numeric(14, 4), nullable=False)
    raw_material_unit_code: Mapped[str] = mapped_column(String(20), nullable=False)
    total_required_material: Mapped[Decimal] = mapped_column(Numeric(14, 4), nullable=False)
    waste_limit_percent: Mapped[Decimal] = mapped_column(Numeric(7, 4), nullable=False)
    expected_finished_weight: Mapped[Decimal] = mapped_column(Numeric(14, 4), nullable=False)
    actual_finished_weight: Mapped[Decimal | None] = mapped_column(Numeric(14, 4), nullable=True)
    waste_weight: Mapped[Decimal | None] = mapped_column(Numeric(14, 4), nullable=True)
    waste_percent: Mapped[Decimal | None] = mapped_column(Numeric(7, 4), nullable=True)
    created_by_user_id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    stages: Mapped[list["ProductionRunStage"]] = relationship(
        back_populates="run",
        cascade="all, delete-orphan",
        order_by="ProductionRunStage.stage_order",
    )


class ProductionRunStage(Base):
    __tablename__ = "production_run_stages"

    id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    run_id: Mapped[PyUUID] = mapped_column(ForeignKey("production_runs.id"), nullable=False, index=True)
    source_stage_id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    stage_name: Mapped[str] = mapped_column(String(180), nullable=False)
    stage_order: Mapped[int] = mapped_column(Integer, nullable=False)
    estimated_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    requires_weighing: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default=ProductionRunStageStatus.PENDING)
    scheduled_start_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    scheduled_finish_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    initial_weight: Mapped[Decimal | None] = mapped_column(Numeric(14, 4), nullable=True)
    final_weight: Mapped[Decimal | None] = mapped_column(Numeric(14, 4), nullable=True)

    run: Mapped[ProductionRun] = relationship(back_populates="stages")
