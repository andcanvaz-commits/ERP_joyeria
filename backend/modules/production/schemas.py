from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


# Banco de procesos (docs/cambios-sistema-produccion.md seccion 3): un paso
# suelto reutilizable, sin etapas ni insumos preconfigurados -- eso se agrega
# suelto por etapa en el acta (mismo mecanismo ADMIN_STOCK/MANUAL de siempre).
class ProductionProcessCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=180)
    description: str | None = Field(default=None, max_length=1000)
    is_active: bool = True
    quality_control: bool = False


class ProductionProcessUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=180)
    description: str | None = Field(default=None, max_length=1000)
    is_active: bool = True
    quality_control: bool = False


class ProductionProcessRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: UUID
    name: str
    code: str | None = None
    description: str | None = None
    is_active: bool
    quality_control: bool


class RunProductCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_type_id: UUID | None = None
    target_item_id: UUID | None = None
    # Cantidad en la unidad de medida del recurso (no necesariamente piezas
    # enteras: puede ser peso).
    quantity: Decimal = Field(gt=0)

    @model_validator(mode="after")
    def _check_one_target(self) -> "RunProductCreate":
        if (self.product_type_id is None) == (self.target_item_id is None):
            raise ValueError(
                "Cada producto del plan debe ser una pieza del inventario o un "
                "tipo del catalogo (uno de los dos)."
            )
        return self


class RunProductsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    products: list[RunProductCreate] = Field(min_length=1)


class StageAttemptProductTarget(BaseModel):
    """Solo el destino del producto resultante -- la cantidad real se llena
    al finalizar la etapa (Rodrigo, 2026-08-20), no se pide aca."""

    model_config = ConfigDict(extra="forbid")

    product_type_id: UUID | None = None
    target_item_id: UUID | None = None

    @model_validator(mode="after")
    def _check_one_target(self) -> "StageAttemptProductTarget":
        if (self.product_type_id is None) == (self.target_item_id is None):
            raise ValueError(
                "El producto resultante debe ser una pieza del inventario o un "
                "tipo del catalogo (uno de los dos)."
            )
        return self


class RunCancelPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str | None = Field(default=None, max_length=1000)


class StageDecisionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    decision: str
    justification: str | None = None
    weight_based: bool = False
    final_weight: Decimal | None = None
    returned_to_order: int | None = None
    decided_by_name: str | None = None
    decided_at: datetime
    attempt_no: int


class ProductionRunStageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: UUID
    source_stage_id: UUID
    stage_name: str
    stage_code: str | None = None
    phase_name: str | None = None
    stage_type: str
    quality_check: str | None = None
    rework_action: str | None = None
    rework_target_order: int | None = None
    stage_order: int
    requires_weighing: bool
    status: str
    scheduled_start_at: datetime | None = None
    scheduled_finish_at: datetime | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    initial_weight: Decimal | None = None
    final_weight: Decimal | None = None
    waste_weight: Decimal | None = None
    waste_percent: Decimal | None = None
    finished_by_name: str | None = None
    decisions: list[StageDecisionRead] = Field(default_factory=list)


class SupplyConsumptionRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    item_id: UUID
    name: str
    quantity: Decimal
    unit_code: str


class ProductionRunEventLineRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    side: str
    gramos: Decimal
    unidad: str
    detalle: str | None = None
    line_order: int


class RunProductRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: UUID
    product_type_id: UUID | None = None
    target_item_id: UUID | None = None
    product_name: str | None = None
    quantity: Decimal
    # Unidad real del item destino (g, und, ...); None si el plan es por
    # product_type_id (categoria sin pieza de catalogo elegida todavia).
    unit_code: str | None = None


class ActaLineRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: UUID
    side: str
    label: str
    quantity: Decimal
    unit_code: str
    item_id: UUID | None = None
    source: str
    stage_id: UUID | None = None
    stage_attempt_id: UUID | None = None
    stage_name: str | None = None
    note: str | None = None
    created_by_name: str | None = None
    created_at: datetime


class ActaLineCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    side: Literal["ENTREGA", "RECEPCION"]
    label: str = Field(min_length=1, max_length=180)
    quantity: Decimal = Field(gt=0)
    unit_code: str = Field(min_length=1, max_length=20)
    # Item real de inventario detras de esta linea, si se conoce (permite
    # fusionar por identidad y no por texto). Opcional: una linea totalmente
    # libre (sin item de catalogo) sigue siendo valida.
    item_id: UUID | None = None
    note: str | None = Field(default=None, max_length=500)
    # Intento de etapa del flujo nuevo al que esta linea pertenece (vacio =
    # linea de nivel de orden, flujo viejo).
    stage_attempt_id: UUID | None = None


class ActaLineUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: str | None = Field(default=None, min_length=1, max_length=180)
    quantity: Decimal | None = Field(default=None, gt=0)
    unit_code: str | None = Field(default=None, min_length=1, max_length=20)
    note: str | None = Field(default=None, max_length=500)


class AdminActaLineCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    side: Literal["ENTREGA", "RECEPCION"]
    # Si viene, la linea se enlaza a este item real y mueve inventario. Si es
    # None, es una linea libre (label/unit_code obligatorios, ver service).
    item_id: UUID | None = None
    label: str | None = Field(default=None, min_length=1, max_length=180)
    quantity: Decimal = Field(gt=0)
    unit_code: str | None = Field(default=None, min_length=1, max_length=20)
    note: str | None = Field(default=None, max_length=500)
    stage_attempt_id: UUID | None = None


# --- Flujo nuevo (docs/cambios-sistema-produccion.md seccion 4) ---


class ProductionOrderCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=255)


class StageAttemptMaterialLine(BaseModel):
    model_config = ConfigDict(extra="forbid")

    item_id: UUID
    quantity: Decimal = Field(gt=0)


class StageAttemptCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    process_id: UUID
    responsable_name: str = Field(min_length=1, max_length=180)
    # Opcional: si viene vacio, la etapa arranca directo (igual que antes).
    # Si trae lineas, se valida contra stock disponible al iniciar -- puede
    # terminar en split si no alcanza (ver ProductionService.start_stage_attempt).
    materials: list[StageAttemptMaterialLine] = Field(default_factory=list)
    # Obligatorio siempre: QUE va a salir de esta etapa (solo el destino --
    # la cantidad real se llena al finalizar, Rodrigo 2026-08-20).
    product: StageAttemptProductTarget


class StageAttemptFinish(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # La decision solo aplica si el proceso tiene control de calidad -- si
    # no, el service la fuerza a APROBADA sin importar lo que venga aca.
    decision: Literal["APROBADA", "RECHAZADA"] = "APROBADA"
    # Opcional -- Rodrigo: el motivo de rechazo no es obligatorio.
    rejection_reason: str | None = Field(default=None, max_length=1000)
    # Cantidad real del producto resultante elegido al iniciar la etapa
    # (Rodrigo, 2026-08-20: no debe salir pre-llena, se llena a mano aca).
    # Convierte el lote y mueve inventario recien en este momento.
    product_quantity: Decimal = Field(gt=0)


class StageAttemptMaterialRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    item_id: UUID
    name: str | None = None
    unit_code: str
    quantity_requested: Decimal
    quantity_pending: Decimal


class StageAttemptRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: UUID
    run_id: UUID
    process_id: UUID | None = None
    process_name: str
    sequence_order: int
    attempt_no_for_process: int
    code: str | None = None
    responsable_name: str | None = None
    status: str
    rejection_reason: str | None = None
    peso_al_finalizar: Decimal | None = None
    unit_code: str | None = None
    # Producto resultante elegido al iniciar (destino, sin cantidad todavia
    # -- ver peso_al_finalizar, que aca hace de cantidad real una vez que se
    # finaliza la etapa).
    target_product_type_id: UUID | None = None
    target_item_id: UUID | None = None
    target_label: str | None = None
    merma_weight: Decimal | None = None
    merma_percent: Decimal | None = None
    started_by_name: str | None = None
    started_at: datetime
    finished_by_name: str | None = None
    finished_at: datetime | None = None
    acta_lines: list[ActaLineRead] = Field(default_factory=list)
    materials: list[StageAttemptMaterialRead] = Field(default_factory=list)


class ProductionRunRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: UUID
    # Nulo en ordenes del flujo nuevo (ver `name` abajo).
    process_id: UUID | None = None
    process_name: str | None = None
    # Nombre libre de la orden (flujo nuevo, seccion 4.1). Nulo en ordenes viejas.
    name: str | None = None
    production_code: str | None = None
    root_production_code: str | None = None
    parent_run_id: UUID | None = None
    quantity: Decimal | None = None
    status: str
    raw_material_item_id: UUID | None
    raw_material_unit_code: str | None = None
    total_required_material: Decimal | None = None
    # Materia prima guardada para esta orden sin consumir todavia. Junto con
    # reservation_is_complete gobierna el boton "Iniciar con lo reservado".
    reserved_material_quantity: Decimal = Decimal("0")
    reservation_is_complete: bool = False
    waste_limit_percent: Decimal | None = None
    expected_finished_weight: Decimal | None = None
    actual_finished_weight: Decimal | None = None
    waste_weight: Decimal | None = None
    waste_percent: Decimal | None = None
    created_by_user_id: UUID
    created_by_name: str | None = None
    started_by_name: str | None = None
    materials_approved_by_name: str | None = None
    received_by_name: str | None = None
    rejected_by_name: str | None = None
    rejection_reason: str | None = None
    rejected_at: datetime | None = None
    # False = rechazo de solicitud (reject_materials, antes de aprobar); True
    # = cancelacion de una orden ya avanzada (cancel_run/cancel_run_family,
    # con reversion de inventario). Distingue "Solicitud rechazada" de
    # "Orden cancelada" en el historial -- antes eran indistinguibles.
    is_cancellation: bool = False
    target_product_type_id: UUID | None = None
    requested_at: datetime
    materials_approved_at: datetime | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    received_at: datetime | None = None
    stages: list[ProductionRunStageRead] = Field(default_factory=list)
    # Intentos de etapa del flujo nuevo (uno por ✔/✘). Vacio en ordenes viejas.
    stage_attempts: list[StageAttemptRead] = Field(default_factory=list)
    # Tipos de producto que el proceso de esta orden puede producir (vacio = todos).
    # Gobierna el combo al convertir el lote en productos terminados.
    allowed_product_type_ids: list[UUID] = Field(default_factory=list)
    # Insumos realmente consumidos al aprobar materiales (desde los movimientos
    # de inventario de la orden). Alimenta el acta de entrega.
    supply_consumptions: list[SupplyConsumptionRead] = Field(default_factory=list)
    # Lineas de detalle por evento (solo ordenes historicas migradas).
    event_lines: list[ProductionRunEventLineRead] = Field(default_factory=list)
    # Plan de resultantes (split).
    products: list[RunProductRead] = Field(default_factory=list)
    # Acta persistida: que entro y que salio de la orden (ver ActaLineSource).
    acta_lines: list[ActaLineRead] = Field(default_factory=list)
