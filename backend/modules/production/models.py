from datetime import datetime
from decimal import Decimal
from uuid import UUID as PyUUID, uuid4

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.modules.database.base import Base


class ProductionProcess(Base):
    """Banco de procesos (docs/cambios-sistema-produccion.md seccion 3): un
    paso suelto reutilizable (ej. "Fundido", "Laminado"), elegible uno a la
    vez al construir una orden del flujo dinamico. Ya NO es una plantilla con
    varias etapas fijas -- eso era el modelo viejo (ProductionProcessStage,
    eliminado). Sin insumos preconfigurados: se agregan sueltos por etapa via
    el mismo mecanismo ADMIN_STOCK/MANUAL que ya existe en el acta."""

    __tablename__ = "production_processes"

    id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    code: Mapped[str | None] = mapped_column(String(10), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)


class ProductionRunStatus:
    # --- Estados del flujo VIEJO (solo ordenes historicas, no se usan para
    # ordenes nuevas -- ver ProductionRunStatus.IN_PROGRESS/FINISHED/CANCELLED
    # para el flujo nuevo). No borrar: hace falta para que Documentos/Reportes
    # sigan mostrando bien las ordenes ya hechas antes de este cambio.
    PENDING_INVENTORY = "PENDIENTE_INVENTARIO"
    # Corrida creada por split (falta materia prima): no entra en la cola
    # normal de aprobacion; solo se activa cuando inventario le destina
    # material desde un ingreso nuevo (ver ProductionService.allocate_material).
    WAITING_MATERIAL = "ESPERANDO_MATERIAL"
    MATERIALS_APPROVED = "MATERIALES_APROBADOS"
    PENDING_RECEPTION = "PENDIENTE_RECEPCION"
    RECEIVED = "RECIBIDA"
    # --- Estados del flujo NUEVO (docs/cambios-sistema-produccion.md seccion
    # 2.3/4): una orden nueva nace directo en IN_PROGRESS (sin aprobacion de
    # materiales) y termina en FINISHED al asignarse a producto terminado.
    IN_PROGRESS = "EN_PROCESO"
    FINISHED = "TERMINADA"
    # Compartido por los dos flujos (viejo: rechazo/cancelacion antes o
    # despues de aprobar; nuevo: cancelar una orden en curso).
    CANCELLED = "CANCELADA"


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
    # Agregada por el admin desde el boton "+" de la acta, enlazada a un
    # InventoryItem real -- a diferencia de MANUAL, esta SI genero un
    # InventoryMovement real (ver _apply_admin_acta_line_delta en service.py).
    ADMIN_STOCK = "ADMIN_STOCK"


class ProductionRunStageStatus:
    PENDING = "PENDIENTE"
    IN_PROGRESS = "EN_PROCESO"
    FINISHED = "FINALIZADA"


class ProductionRun(Base):
    __tablename__ = "production_runs"

    id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    # Nulo en ordenes del flujo nuevo (docs seccion 4.1): esas nacen con solo
    # un nombre libre, sin proceso ni materia prima fijos -- eso se declara
    # etapa por etapa (ver ProductionRunStageAttempt). Las ordenes viejas
    # siguen usando process_id/process_name/quantity tal cual.
    process_id: Mapped[PyUUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True, index=True)
    process_name: Mapped[str | None] = mapped_column(String(180), nullable=True)
    quantity: Mapped[Decimal | None] = mapped_column(Numeric(14, 4), nullable=True)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default=ProductionRunStatus.PENDING_INVENTORY)
    # Nombre libre de la orden (flujo nuevo, seccion 4.1). Nulo en ordenes
    # viejas -- esas se identifican por process_name.
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Nulo en ordenes historicas migradas (import de certificados de papel):
    # esas actas nunca referencian una materia prima real del inventario.
    raw_material_item_id: Mapped[PyUUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    # Nulo en ordenes del flujo nuevo: no hay una sola materia prima/unidad
    # fija para toda la orden, cada etapa declara la suya en su propia acta.
    raw_material_unit_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    total_required_material: Mapped[Decimal | None] = mapped_column(Numeric(14, 4), nullable=True)
    # Materia prima RESERVADA pero aun no consumida: inventario destino stock a
    # esta corrida y eligio esperar a completar todo antes de arrancar. No es un
    # movimiento -- el stock sigue fisicamente en el item, pero deja de estar
    # disponible para otras ordenes (ver InventoryService.available_stock).
    # Solo aplica al flujo viejo (con aprobacion de materiales).
    reserved_material_quantity: Mapped[Decimal] = mapped_column(
        Numeric(14, 4), nullable=False, default=Decimal("0"), server_default="0"
    )
    waste_limit_percent: Mapped[Decimal | None] = mapped_column(Numeric(7, 4), nullable=True)
    expected_finished_weight: Mapped[Decimal | None] = mapped_column(Numeric(14, 4), nullable=True)
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
    # Intentos de etapa del flujo nuevo (uno por cada ✔/✘, seccion 4). Ordenes
    # viejas usan `stages` en vez de esto.
    stage_attempts: Mapped[list["ProductionRunStageAttempt"]] = relationship(
        back_populates="run",
        cascade="all, delete-orphan",
        order_by="ProductionRunStageAttempt.sequence_order",
    )
    # Plan de productos resultantes declarado al crear la orden (split):
    # a qué tipos del catálogo se convierte el lote al recibirlo.
    products: Mapped[list["ProductionRunProduct"]] = relationship(
        back_populates="run",
        cascade="all, delete-orphan",
        order_by="ProductionRunProduct.line_order",
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
    # Guardado para esta orden pero todavia no consumido.
    reserved_quantity: Mapped[Decimal] = mapped_column(
        Numeric(14, 4), nullable=False, default=Decimal("0"), server_default="0"
    )

    stage: Mapped["ProductionRunStage"] = relationship(back_populates="ingredients")


class StageAttemptStatus:
    IN_PROGRESS = "EN_PROCESO"
    APPROVED = "APROBADA"
    REJECTED = "RECHAZADA"
    # Split por falta de stock al iniciar la etapa (o al asignar despues del
    # split): la parte cubierta arranca en IN_PROGRESS, el remanente queda
    # aca hasta que alguien apriete "Asignar material disponible"
    # (allocate_stage_attempt_material) y alcance el 100%.
    WAITING_MATERIAL = "PENDIENTE_MATERIAL"


class ProductionRunStageAttempt(Base):
    """Un intento de etapa del flujo nuevo (docs/cambios-sistema-produccion.md
    seccion 4): un ✔ o un ✘. Reemplaza a ProductionRunStage para ordenes
    nuevas -- las viejas siguen usando esa tabla, sin tocar. La merma es
    propia de CADA intento (entregado de este mismo intento - peso al
    finalizar), no se compara contra el intento anterior."""

    __tablename__ = "production_run_stage_attempts"

    id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    run_id: Mapped[PyUUID] = mapped_column(
        ForeignKey("production_runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # El proceso del banco pudo borrarse despues -- process_name denormalizado
    # sobrevive para que el intento siga siendo legible.
    process_id: Mapped[PyUUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("production_processes.id", ondelete="SET NULL"), nullable=True
    )
    process_name: Mapped[str] = mapped_column(String(180), nullable=False)
    # Orden cronologico dentro de la orden, incluye intentos rechazados.
    sequence_order: Mapped[int] = mapped_column(Integer, nullable=False)
    # Cuantas veces se uso ESTE MISMO proceso en esta orden (1, 2, ...) --
    # alimenta el sufijo del codigo de acta (FUND-01, FUND-02), contado por
    # proceso, no por posicion cronologica (seccion 8).
    attempt_no_for_process: Mapped[int] = mapped_column(Integer, nullable=False)
    # Codigo del acta de este intento: {codigo de orden}-{ABREV}-{NN}.
    code: Mapped[str | None] = mapped_column(String(60), nullable=True)
    # Texto libre, lo llena Produccion/Inventario al iniciar (seccion 4.2) --
    # no es una cuenta de usuario, igual criterio que los *_responsable_name
    # de ordenes historicas.
    responsable_name: Mapped[str | None] = mapped_column(String(180), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=StageAttemptStatus.IN_PROGRESS)
    # Motivo del rechazo (✘) -- opcional, no obligatorio.
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    peso_al_finalizar: Mapped[Decimal | None] = mapped_column(Numeric(14, 4), nullable=True)
    unit_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # Merma de ESTE intento unicamente: suma(ENTREGA de este intento) - peso
    # al finalizar. Solo se calcula al aprobar (✔).
    merma_weight: Mapped[Decimal | None] = mapped_column(Numeric(14, 4), nullable=True)
    merma_percent: Mapped[Decimal | None] = mapped_column(Numeric(7, 4), nullable=True)
    started_by_user_id: Mapped[PyUUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    finished_by_user_id: Mapped[PyUUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    materials: Mapped[list["ProductionRunStageAttemptMaterial"]] = relationship(
        back_populates="stage_attempt",
        cascade="all, delete-orphan",
    )

    run: Mapped["ProductionRun"] = relationship(back_populates="stage_attempts")


class ProductionRunStageAttemptMaterial(Base):
    """Una linea de material declarada al iniciar un intento de etapa (flujo
    nuevo, seccion 4). quantity_pending baja cada vez que se consume (al
    iniciar si alcanza, o via allocate_stage_attempt_material si quedo
    corta) -- llega a 0 cuando esta linea esta completamente cubierta."""

    __tablename__ = "production_run_stage_attempt_materials"

    id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    stage_attempt_id: Mapped[PyUUID] = mapped_column(
        ForeignKey("production_run_stage_attempts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    item_id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    unit_code: Mapped[str] = mapped_column(String(20), nullable=False)
    quantity_requested: Mapped[Decimal] = mapped_column(Numeric(14, 4), nullable=False)
    quantity_pending: Mapped[Decimal] = mapped_column(Numeric(14, 4), nullable=False)

    stage_attempt: Mapped["ProductionRunStageAttempt"] = relationship(back_populates="materials")


class ProductionRunActaLine(Base):
    __tablename__ = "production_run_acta_lines"

    id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    run_id: Mapped[PyUUID] = mapped_column(
        ForeignKey("production_runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Etapa a la que esta linea esta ligada (ej. merma de esa etapa), o NULL
    # si es una linea de nivel de orden (materia prima, producto final, etc.).
    # Flujo VIEJO unicamente -- ordenes nuevas usan stage_attempt_id (nunca
    # los dos a la vez).
    stage_id: Mapped[PyUUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("production_run_stages.id", ondelete="SET NULL"), nullable=True
    )
    # Intento de etapa (flujo nuevo) al que esta linea esta ligada.
    stage_attempt_id: Mapped[PyUUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("production_run_stage_attempts.id", ondelete="SET NULL"),
        nullable=True,
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
