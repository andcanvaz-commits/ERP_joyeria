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
    code: Mapped[str | None] = mapped_column(String(10), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    waste_limit_percent: Mapped[Decimal] = mapped_column(Numeric(7, 4), nullable=False, default=Decimal("1"))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    stages: Mapped[list["ProductionProcessStage"]] = relationship(
        back_populates="process",
        cascade="all, delete-orphan",
        order_by="ProductionProcessStage.stage_order",
    )
    # Tipos de producto del catalogo que este proceso puede producir. Vacio =
    # produce cualquier tipo. Gobierna el combo de conversion de lotes.
    product_types: Mapped[list["ProductionProcessProductType"]] = relationship(
        back_populates="process",
        cascade="all, delete-orphan",
    )


class ProductionProcessProductType(Base):
    __tablename__ = "production_process_product_types"

    id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    process_id: Mapped[PyUUID] = mapped_column(
        ForeignKey("production_processes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    product_type_id: Mapped[PyUUID] = mapped_column(
        ForeignKey("product_types.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    process: Mapped["ProductionProcess"] = relationship(back_populates="product_types")


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
    requires_weighing: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    initial_weight: Mapped[Decimal | None] = mapped_column(Numeric(14, 4), nullable=True)
    final_weight: Mapped[Decimal | None] = mapped_column(Numeric(14, 4), nullable=True)

    process: Mapped["ProductionProcess"] = relationship(back_populates="stages")
    ingredients: Mapped[list["ProductionProcessStageIngredient"]] = relationship(
        back_populates="stage",
        cascade="all, delete-orphan",
    )

    @property
    def waste_percent(self) -> Decimal | None:
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

    stage: Mapped["ProductionProcessStage"] = relationship(back_populates="ingredients")


class ProductionRunStatus:
    PENDING_INVENTORY = "PENDIENTE_INVENTARIO"
    # Corrida creada por split (falta materia prima): no entra en la cola
    # normal de aprobacion; solo se activa cuando inventario le destina
    # material desde un ingreso nuevo (ver ProductionService.allocate_material).
    WAITING_MATERIAL = "ESPERANDO_MATERIAL"
    MATERIALS_APPROVED = "MATERIALES_APROBADOS"
    IN_PROGRESS = "EN_PROCESO"
    PENDING_RECEPTION = "PENDIENTE_RECEPCION"
    RECEIVED = "RECIBIDA"
    CANCELLED = "CANCELADA"


class AssemblyMode:
    ASSIGN = "ASIGNAR"
    ASSEMBLE = "ENSAMBLAR"


class ComplementRequestStatus:
    PENDING = "PENDIENTE"
    APPROVED = "APROBADA"
    REJECTED = "RECHAZADA"


class ActaLineSide:
    ENTREGA = "ENTREGA"
    RECEPCION = "RECEPCION"


class ActaLineSource:
    # Sembrada automaticamente al crear la orden, con los valores planeados.
    PLAN = "PLAN"
    # Agregada automaticamente por un evento del sistema (material adicional
    # aprobado, etapa finalizada con merma, recepcion real).
    AUTO = "AUTO"
    # Agregada a mano por un usuario editando el acta.
    MANUAL = "MANUAL"


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
    status: Mapped[str] = mapped_column(String(30), nullable=False, default=ProductionRunStatus.PENDING_INVENTORY)
    # Modo de la orden: ASIGNAR (split directo) o ENSAMBLAR (con complementos).
    assembly_mode: Mapped[str] = mapped_column(String(20), nullable=False, default=AssemblyMode.ASSIGN)
    # ENSAMBLAR sin receta aplicable: producción debe definir la combinación
    # antes de que inventario pueda recibir.
    assembly_pending: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Nulo en ordenes historicas migradas (import de certificados de papel):
    # esas actas nunca referencian una materia prima real del inventario.
    raw_material_item_id: Mapped[PyUUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    raw_material_unit_code: Mapped[str] = mapped_column(String(20), nullable=False)
    total_required_material: Mapped[Decimal] = mapped_column(Numeric(14, 4), nullable=False)
    # Materia prima RESERVADA pero aun no consumida: inventario destino stock a
    # esta corrida y eligio esperar a completar todo antes de arrancar. No es un
    # movimiento -- el stock sigue fisicamente en el item, pero deja de estar
    # disponible para otras ordenes (ver InventoryService.available_stock).
    reserved_material_quantity: Mapped[Decimal] = mapped_column(
        Numeric(14, 4), nullable=False, default=Decimal("0"), server_default="0"
    )
    waste_limit_percent: Mapped[Decimal] = mapped_column(Numeric(7, 4), nullable=False)
    expected_finished_weight: Mapped[Decimal] = mapped_column(Numeric(14, 4), nullable=False)
    actual_finished_weight: Mapped[Decimal | None] = mapped_column(Numeric(14, 4), nullable=True)
    waste_weight: Mapped[Decimal | None] = mapped_column(Numeric(14, 4), nullable=True)
    waste_percent: Mapped[Decimal | None] = mapped_column(Numeric(7, 4), nullable=True)
    # Ya no es unico: una orden partida por falta de materia prima genera
    # corridas hijas con el mismo root_production_code (el "certificado") y
    # su propio production_code con sufijo (OP-2026-0001-B, -C, ...).
    production_code: Mapped[str | None] = mapped_column(String(30), nullable=True, index=True)
    root_production_code: Mapped[str | None] = mapped_column(String(30), nullable=True, index=True)
    parent_run_id: Mapped[PyUUID | None] = mapped_column(
        ForeignKey("production_runs.id", ondelete="SET NULL"), nullable=True
    )
    created_by_user_id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    started_by_user_id: Mapped[PyUUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    materials_approved_by_user_id: Mapped[PyUUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    received_by_user_id: Mapped[PyUUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    rejected_by_user_id: Mapped[PyUUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Nombre de responsable en texto libre: se usa cuando no hay
    # materials_approved_by_user_id/received_by_user_id (ordenes historicas
    # migradas de papel, sin cuenta de usuario real). Si el user_id existe,
    # el nombre resuelto por cuenta siempre gana (ver _populate_run_names).
    materials_approved_responsable_name: Mapped[str | None] = mapped_column(String(180), nullable=True)
    received_responsable_name: Mapped[str | None] = mapped_column(String(180), nullable=True)
    rejected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # rejected_by_user_id/rejection_reason/rejected_at se llenan igual desde
    # reject_materials (rechazo antes de aprobar, PENDIENTE_INVENTARIO) que
    # desde cancel_run/cancel_run_family (cancelacion de una orden ya
    # avanzada, con reversion de inventario) -- sin este campo, el frontend
    # no podia distinguir "Solicitud rechazada" de "Orden cancelada" y
    # mostraba el primero para los dos casos (bug reportado: confundia con
    # un rechazo real de Inventario). False = rechazo (default, incluye las
    # filas viejas anteriores a esta columna: la funcion de cancelar una
    # orden ya avanzada es nueva, casi todo lo historico es rechazo real).
    is_cancellation: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Producto objetivo declarado al crear la orden (opcional): intención, no
    # obligación — la clasificación real ocurre al convertir el lote.
    target_product_type_id: Mapped[PyUUID | None] = mapped_column(
        ForeignKey("product_types.id", ondelete="SET NULL"), nullable=True
    )
    requested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    materials_approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    received_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    stages: Mapped[list["ProductionRunStage"]] = relationship(
        back_populates="run",
        cascade="all, delete-orphan",
        order_by="ProductionRunStage.stage_order",
    )
    # Plan de productos resultantes declarado al crear la orden (split):
    # a qué tipos del catálogo se convierte el lote al recibirlo.
    products: Mapped[list["ProductionRunProduct"]] = relationship(
        back_populates="run",
        cascade="all, delete-orphan",
        order_by="ProductionRunProduct.line_order",
    )
    # Complementos de inventario solicitados para ensamblar con la producción.
    complements: Mapped[list["ProductionComplementRequest"]] = relationship(
        back_populates="run",
        cascade="all, delete-orphan",
    )
    # Lineas de detalle por evento de entrega/recepcion (solo ordenes
    # historicas migradas: una corrida en vivo nunca las llena). Cuando
    # existen para un lado, el certificado las usa en vez de la fila unica
    # calculada de total_required_material — ver buildOrdenProduccion.
    event_lines: Mapped[list["ProductionRunEventLine"]] = relationship(
        back_populates="run",
        cascade="all, delete-orphan",
        order_by="ProductionRunEventLine.line_order",
    )
    # Combinación de complementos aplicada al ensamble (cantidades totales).
    assembly_items: Mapped[list["ProductionRunAssemblyItem"]] = relationship(
        back_populates="run",
        cascade="all, delete-orphan",
    )
    # Acta persistida: que entro y que salio de la orden, sembrada con el plan
    # al crearla y alimentada por eventos reales despues (ver ActaLineSource).
    acta_lines: Mapped[list["ProductionRunActaLine"]] = relationship(
        back_populates="run",
        cascade="all, delete-orphan",
        order_by="ProductionRunActaLine.line_order",
    )
    # Material adicional pedido mientras la corrida esta EN_PROCESO, fuera de
    # lo declarado al crear la orden.
    additional_material_requests: Mapped[list["ProductionRunAdditionalMaterialRequest"]] = relationship(
        back_populates="run",
        cascade="all, delete-orphan",
        order_by="ProductionRunAdditionalMaterialRequest.requested_at",
    )


class ProductionRunStage(Base):
    __tablename__ = "production_run_stages"

    id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    run_id: Mapped[PyUUID] = mapped_column(ForeignKey("production_runs.id"), nullable=False, index=True)
    source_stage_id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    stage_name: Mapped[str] = mapped_column(String(180), nullable=False)
    phase_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    stage_type: Mapped[str] = mapped_column(String(40), nullable=False, default="PROCESS")
    quality_check: Mapped[str | None] = mapped_column(Text, nullable=True)
    rework_action: Mapped[str | None] = mapped_column(Text, nullable=True)
    rework_target_order: Mapped[int | None] = mapped_column(Integer, nullable=True)
    stage_code: Mapped[str | None] = mapped_column(String(40), nullable=True)
    stage_order: Mapped[int] = mapped_column(Integer, nullable=False)
    initial_weight: Mapped[Decimal | None] = mapped_column(Numeric(14, 4), nullable=True)
    final_weight: Mapped[Decimal | None] = mapped_column(Numeric(14, 4), nullable=True)
    requires_weighing: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default=ProductionRunStageStatus.PENDING)
    scheduled_start_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    scheduled_finish_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_by_user_id: Mapped[PyUUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    # Merma registrada al finalizar la etapa: cuanto material se perdio en ella.
    waste_weight: Mapped[Decimal | None] = mapped_column(Numeric(14, 4), nullable=True)
    waste_percent: Mapped[Decimal | None] = mapped_column(Numeric(7, 4), nullable=True)
    ingredients: Mapped[list["ProductionRunStageIngredient"]] = relationship(
        back_populates="stage",
        cascade="all, delete-orphan",
    )

    run: Mapped[ProductionRun] = relationship(back_populates="stages")
    decisions: Mapped[list["ProductionRunStageDecision"]] = relationship(
        back_populates="stage",
        cascade="all, delete-orphan",
        order_by="ProductionRunStageDecision.attempt_no",
    )


class ProductionRunStageDecision(Base):
    __tablename__ = "production_run_stage_decisions"

    id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    run_id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    run_stage_id: Mapped[PyUUID] = mapped_column(
        ForeignKey("production_run_stages.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    decision: Mapped[str] = mapped_column(String(20), nullable=False)
    justification: Mapped[str | None] = mapped_column(Text, nullable=True)
    weight_based: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    final_weight: Mapped[Decimal | None] = mapped_column(Numeric(14, 4), nullable=True)
    returned_to_order: Mapped[int | None] = mapped_column(Integer, nullable=True)
    decided_by_user_id: Mapped[PyUUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    decided_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    attempt_no: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    stage: Mapped["ProductionRunStage"] = relationship(back_populates="decisions")


class ProductionRunStageIngredient(Base):
    __tablename__ = "production_run_stage_ingredients"

    id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    run_stage_id: Mapped[PyUUID] = mapped_column(
        ForeignKey("production_run_stages.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    inventory_item_id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 4), nullable=False)
    unit_code: Mapped[str] = mapped_column(String(20), nullable=False)
    # Guardado para esta orden pero todavia no consumido (mismo patron que
    # ProductionComplementRequest.reserved_quantity).
    reserved_quantity: Mapped[Decimal] = mapped_column(
        Numeric(14, 4), nullable=False, default=Decimal("0"), server_default="0"
    )

    stage: Mapped["ProductionRunStage"] = relationship(back_populates="ingredients")


class ProductionRunActaLine(Base):
    __tablename__ = "production_run_acta_lines"

    id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    run_id: Mapped[PyUUID] = mapped_column(
        ForeignKey("production_runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Etapa a la que esta linea esta ligada (ej. merma de esa etapa), o NULL
    # si es una linea de nivel de orden (materia prima, producto final, etc.).
    stage_id: Mapped[PyUUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("production_run_stages.id", ondelete="SET NULL"), nullable=True
    )
    side: Mapped[str] = mapped_column(String(20), nullable=False)
    label: Mapped[str] = mapped_column(String(180), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 4), nullable=False)
    unit_code: Mapped[str] = mapped_column(String(20), nullable=False)
    # Item real de inventario detras de esta linea (materia prima, insumo o
    # complemento). NULL en lineas que no representan un item puntual (ej. un
    # producto resultante por tipo de catalogo). Es lo que permite fusionar
    # por identidad real en vez de por texto -- dos items distintos pueden
    # coincidir en nombre+unidad y no son lo mismo.
    item_id: Mapped[PyUUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    source: Mapped[str] = mapped_column(String(20), nullable=False, default=ActaLineSource.PLAN)
    line_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[PyUUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    run: Mapped["ProductionRun"] = relationship(back_populates="acta_lines")


class ProductionRunAdditionalMaterialRequest(Base):
    __tablename__ = "production_run_additional_material_requests"

    id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    run_id: Mapped[PyUUID] = mapped_column(
        ForeignKey("production_runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Etapa que estaba EN_PROCESO cuando se pidio (para trazabilidad/acta), o
    # NULL si al pedirlo ninguna etapa estaba activa.
    stage_id: Mapped[PyUUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("production_run_stages.id", ondelete="SET NULL"), nullable=True
    )
    item_id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 4), nullable=False)
    unit_code: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=ComplementRequestStatus.PENDING)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    requested_by_user_id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    requested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    approved_by_user_id: Mapped[PyUUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    run: Mapped["ProductionRun"] = relationship(back_populates="additional_material_requests")


class ProductionRunProduct(Base):
    __tablename__ = "production_run_products"

    id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    run_id: Mapped[PyUUID] = mapped_column(
        ForeignKey("production_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    product_type_id: Mapped[PyUUID | None] = mapped_column(
        ForeignKey("product_types.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    # Destino por pieza existente del inventario (opcional; excluyente con
    # product_type_id — exactamente uno de los dos).
    target_item_id: Mapped[PyUUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 4), nullable=False)
    # Orden de declaracion de la linea: el split de una orden por falta de
    # materia prima llena el padre en este orden; sin esto, Postgres no
    # garantiza el orden de lectura de la coleccion tras un reload.
    line_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    run: Mapped["ProductionRun"] = relationship(back_populates="products")


class ProductionComplementRequest(Base):
    __tablename__ = "production_complement_requests"

    id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    run_id: Mapped[PyUUID] = mapped_column(
        ForeignKey("production_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    item_id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 4), nullable=False)
    # Parcial a proposito: el stock llega de a poco y la reserva se acumula
    # ingreso tras ingreso hasta cubrir `quantity`. Un status "RESERVADO" de
    # todo-o-nada impediria juntar el faltante en varias entradas, que es
    # justo el caso de uso.
    reserved_quantity: Mapped[Decimal] = mapped_column(
        Numeric(14, 4), nullable=False, default=Decimal("0"), server_default="0"
    )
    unit_code: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=ComplementRequestStatus.PENDING
    )
    approved_by_user_id: Mapped[PyUUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Cuanto de lo aprobado (y ya descontado de inventario al aprobar) se
    # devolvio por sobrante al recibir: aprobado - usado en ensamble -
    # devuelto = lo que todavia falta devolver. Ver ProductionService.
    # return_complement.
    returned_quantity: Mapped[Decimal] = mapped_column(
        Numeric(14, 4), nullable=False, default=Decimal("0"), server_default="0"
    )

    run: Mapped["ProductionRun"] = relationship(back_populates="complements")


class AssemblyRecipe(Base):
    """Receta de ensamble por tipo de producto: qué complementos y cuántos POR
    UNIDAD. Se aprende del primer ensamble manual y luego aplica sola."""

    __tablename__ = "assembly_recipes"

    id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    # Clave de modelo: material(1)+categoria(2)+modelo(4), el codigo de
    # catalogo completo de 7 digitos — la receta NO se comparte entre
    # materiales (oro y plata tienen recetas distintas).
    model_key: Mapped[str] = mapped_column(String(7), nullable=False, unique=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    # Corrida que la creo (null si se creo a mano en Mantenimiento, o para
    # recetas ya existentes antes de esta columna). Solo se setea al CREAR la
    # receta -- si otra corrida despues la actualiza, esto no cambia. Sirve
    # para borrar la receta si esa corrida en particular se cancela (ver
    # ProductionService.cancel_run/_cancel_orphaned_recipe); si una corrida
    # distinta ya la reuso/actualizo, cancelar la creadora original ya no la
    # toca (dejo de ser "solo de esta orden").
    created_by_run_id: Mapped[PyUUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("production_runs.id", ondelete="SET NULL"), nullable=True
    )

    items: Mapped[list["AssemblyRecipeItem"]] = relationship(
        back_populates="recipe",
        cascade="all, delete-orphan",
    )


class AssemblyRecipeItem(Base):
    __tablename__ = "assembly_recipe_items"

    id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    recipe_id: Mapped[PyUUID] = mapped_column(
        ForeignKey("assembly_recipes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    complement_item_id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 4), nullable=False)

    recipe: Mapped["AssemblyRecipe"] = relationship(back_populates="items")


class ProductionRunAssemblyItem(Base):
    __tablename__ = "production_run_assembly_items"

    id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    run_id: Mapped[PyUUID] = mapped_column(
        ForeignKey("production_runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    complement_item_id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 4), nullable=False)

    run: Mapped["ProductionRun"] = relationship(back_populates="assembly_items")


class ProductionRunEventLine(Base):
    __tablename__ = "production_run_event_lines"

    id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    run_id: Mapped[PyUUID] = mapped_column(
        ForeignKey("production_runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    side: Mapped[str] = mapped_column(String(20), nullable=False)
    gramos: Mapped[Decimal] = mapped_column(Numeric(14, 4), nullable=False)
    unidad: Mapped[str] = mapped_column(String(20), nullable=False)
    detalle: Mapped[str | None] = mapped_column(Text, nullable=True)
    line_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    run: Mapped["ProductionRun"] = relationship(back_populates="event_lines")


class ProductionRunEventSide:
    ENTREGA = "ENTREGA"
    RECEPCION = "RECEPCION"
