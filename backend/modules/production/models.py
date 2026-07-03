from datetime import datetime
from decimal import Decimal
from uuid import UUID as PyUUID, uuid4

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.modules.database.base import Base


class ProductionRunStatus:
    PENDING_INVENTORY = "PENDIENTE_INVENTARIO"
    MATERIALS_APPROVED = "MATERIALES_APROBADOS"
    IN_PROGRESS = "EN_PROCESO"
    PENDING_RECEPTION = "PENDIENTE_RECEPCION"
    RECEIVED = "RECIBIDA"
    CANCELLED = "CANCELADA"


class ProductionRunStageStatus:
    PENDING = "PENDIENTE"
    IN_PROGRESS = "EN_PROCESO"
    FINISHED = "FINALIZADA"


class ProductionProcess(Base):
    __tablename__ = "production_processes"

    id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    code: Mapped[str | None] = mapped_column(String(10), nullable=True)
    product_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    raw_material_item_id: Mapped[PyUUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    raw_material_quantity_per_unit: Mapped[Decimal | None] = mapped_column(Numeric(14, 4), nullable=True)
    raw_material_unit_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    waste_limit_percent: Mapped[Decimal] = mapped_column(Numeric(7, 4), nullable=False, default=Decimal("1"))  # <-- changed to 1%
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
    phase_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    stage_type: Mapped[str] = mapped_column(String(40), nullable=False, default="PROCESS")
    quality_check: Mapped[str | None] = mapped_column(Text, nullable=True)
    rework_action: Mapped[str | None] = mapped_column(Text, nullable=True)
    rework_target_order: Mapped[int | None] = mapped_column(Integer, nullable=True)
    stage_order: Mapped[int] = mapped_column(Integer, nullable=False)
    estimated_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    requires_weighing: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    initial_weight: Mapped[Decimal | None] = mapped_column(Numeric(14, 4), nullable=True)
    final_weight: Mapped[Decimal | None] = mapped_column(Numeric(14, 4), nullable=True)

    # -----------------------------------------------------------------
    # Relationships
    # -----------------------------------------------------------------
    process: Mapped["ProductionProcess"] = relationship(back_populates="stages")
    ingredients: Mapped[list["ProductionProcessStageIngredient"]] = relationship(
        back_populates="stage",
        cascade="all, delete-orphan",
    )
    # decisions will be defined in ProductionRunStage (see below)

    # -----------------------------------------------------------------
    # Computed property
    # -----------------------------------------------------------------
    @property
    def waste_percent(self) -> Decimal | None:
        """Percentage of material lost in this stage (based on weighed weights)."""
        if (
            self.initial_weight is not None
            and self.final_weight is not None
            and self.initial_weight > 0
        ):
            return (self.initial_weight - self.final_weight) / self.initial_weight * Decimal("100")
        return None


class ProductionProcessStageIngredient(Base):
    __tablename__ = "production_process_stage_ingredients"

    id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    stage_id: Mapped[PyUUID] = mapped_column(
        ForeignKey("production_process_stages.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    inventory_item_id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 4), nullable=False)
    unit_code: Mapped[str] = mapped_column(String(20), nullable=False)

    stage: Mapped["ProductionProcessStage"] = relationship(back_populates="ingredients")


class ProductionRun(Base):
    __tablename__ = "production_runs"

    id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    process_id: Mapped[PyUUID] = mapped_column(ForeignKey("production_processes.id"), nullable=False)
    process_name: Mapped[str] = mapped_column(String(180), nullable=False)
    product_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    production_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 4), nullable=False)
    status: Mapped[str] = mapped_column(String(30), nullable=False)
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
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    requested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    materials_approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    materials_approved_by_user_id: Mapped[PyUUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    started_by_user_id: Mapped[PyUUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    received_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    received_by_user_id: Mapped[PyUUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    rejected_by_user_id: Mapped[PyUUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Relationships
    process: Mapped["ProductionProcess"] = relationship()
    stages: Mapped[list["ProductionRunStage"]] = relationship(
        back_populates="run",
        cascade="all, delete-orphan",
        order_by="ProductionRunStage.stage_order",
    )