from datetime import datetime
from decimal import ROUND_DOWN, Decimal
from uuid import UUID

from backend.modules.auth.dependencies import CurrentUser
from backend.modules.inventory.schemas import InventoryMovementCreate
from backend.modules.inventory.service import (
    InventoryDomainError,
    InventoryNotFoundError,
    InventoryService,
)
from backend.modules.shared.formatting import format_qty
from backend.modules.production.models import (
    ActaLineSide,
    ActaLineSource,
    ProductionProcess,
    ProductionRun,
    ProductionRunActaLine,
    ProductionRunProduct,
    ProductionRunStageAttempt,
    ProductionRunStageAttemptMaterial,
    ProductionRunStageStatus,
    ProductionRunStatus,
    StageAttemptStatus,
)
from backend.modules.production.repository import ProductionProcessRepository
from backend.modules.production.schemas import (
    ActaLineCreate,
    ActaLineRead,
    ActaLineUpdate,
    AdminActaLineCreate,
    ProductionOrderCreate,
    ProductionProcessCreate,
    ProductionProcessRead,
    ProductionProcessUpdate,
    ProductionRunRead,
    RunProductsUpdate,
    StageAttemptCreate,
    StageAttemptFinish,
    StageAttemptMaterialRead,
    StageAttemptRead,
    SupplyConsumptionRead,
)


def _resolve_run_user_names(session, user_ids: list) -> dict:
    if not user_ids:
        return {}
    from sqlalchemy import select
    from backend.modules.auth.models import AuthUser
    unique_ids = list({uid for uid in user_ids if uid})
    if not unique_ids:
        return {}
    users = session.execute(select(AuthUser).where(AuthUser.id.in_(unique_ids))).scalars().all()
    result = {}
    for user in users:
        name = f"{user.first_name or ''} {user.last_name or ''}".strip()
        result[str(user.id)] = name or user.username
    return result


def _populate_run_names(session, reads: list, runs: list) -> None:
    """Resuelve los nombres de las cuentas que actuaron sobre cada orden y etapa
    (creo / inicio / aprobo / recibio / finalizo etapa) y los asigna a los reads."""
    ids: list = []
    for run in runs:
        ids.extend([
            run.created_by_user_id,
            run.started_by_user_id,
            run.materials_approved_by_user_id,
            run.received_by_user_id,
            run.rejected_by_user_id,
        ])
        for stage in run.stages:
            ids.append(stage.finished_by_user_id)
            for decision in stage.decisions:
                ids.append(decision.decided_by_user_id)
    names = _resolve_run_user_names(session, [i for i in ids if i])

    def name_for(value):
        return names.get(str(value)) if value else None

    for read, run in zip(reads, runs):
        read.created_by_name = name_for(run.created_by_user_id)
        read.started_by_name = name_for(run.started_by_user_id)
        read.materials_approved_by_name = (
            name_for(run.materials_approved_by_user_id) or run.materials_approved_responsable_name
        )
        read.received_by_name = name_for(run.received_by_user_id) or run.received_responsable_name
        read.rejected_by_name = name_for(run.rejected_by_user_id)
        stages_by_id = {str(stage.id): stage for stage in run.stages}
        for stage_read in read.stages:
            stage = stages_by_id.get(str(stage_read.id))
            if stage is not None:
                stage_read.finished_by_name = name_for(stage.finished_by_user_id)
                for decision_read, decision in zip(stage_read.decisions, stage.decisions):
                    decision_read.decided_by_name = name_for(decision.decided_by_user_id)


# Procesos de ejemplo tomados de los documentos de la joyeria (cadenas, monedas,
# medallas y casting). Viven solo como DATOS de siembra; el sistema sigue siendo
# generico y el administrador puede editarlos o crear procesos totalmente nuevos.
# Tipos de etapa: PROCESS, THERMAL, CHEMICAL, CONTROL, DECISION.
EXAMPLE_PROCESSES: tuple[dict, ...] = (
    {
        "name": "PLATA CADENA BB",
        "description": "Proceso de ejemplo.",
        "material_per_unit": Decimal("10.0000"),
        "waste_limit_percent": Decimal("1"),
        "stages": (
            {"name": "Fundicion", "stage_type": "THERMAL", "requires_weighing": True,
             "description": "El metal se funde y se prepara la materia prima."},
            {"name": "Control de calidad", "stage_type": "CONTROL", "requires_weighing": True,
             "description": "Se revisa la pieza y se aprueba o rechaza.",
             "quality_check": "Cumple el estandar de calidad?",
             "rework_action": "Si no cumple, regresa a Fundicion."},
            {"name": "Acabado", "stage_type": "PROCESS", "requires_weighing": True,
             "description": "Pulido y acabado final; la pieza queda lista."},
        ),
    },
)


def _generate_production_code(repository: "ProductionProcessRepository", year: int) -> str:
    seq = repository.next_run_seq_this_year(year)
    return f"OP-{year}-{seq:04d}"


def _stage_code_for(stage_name: str, run_seq: int, stage_order: int) -> str:
    prefix = "".join(c for c in stage_name.upper() if c.isalpha())[:3] or "ETB"
    return f"{prefix}-OP{run_seq:04d}-{stage_order:02d}"


def _stage_attempt_code_for(order_code: str, process_name: str, attempt_no_for_process: int) -> str:
    """Codigo de acta de un intento de etapa (seccion 8):
    {codigo de orden}-{ABREV}-{NN}, ej. OP-2026-0001-FUND-01. El secuencial
    es por PROCESO dentro de la orden, no por posicion cronologica -- si
    Fundido se repite (rechazo), la siguiente acta de Fundido en esa misma
    orden es FUND-02, aunque entre medio se haya usado otro proceso."""
    prefix = "".join(c for c in process_name.upper() if c.isalpha())[:4] or "ETPA"
    return f"{order_code}-{prefix}-{attempt_no_for_process:02d}"


def _waste_line_label(stage_name: str) -> str:
    """Etiqueta de la fila de merma por etapa. `stage_name` es dato libre del
    proceso (no hardcodeado): si el admin ya nombro la etapa "Etapa 2", no
    hay que anteponer otra vez "etapa" (salia "Merma etapa Etapa 2" -- bug
    reportado por Rodrigo, la palabra se repetia)."""
    if stage_name.strip().lower().startswith("etapa"):
        return f"Merma {stage_name}"
    return f"Merma etapa {stage_name}"


def _reservation_is_complete(run: ProductionRun) -> bool:
    """True si la corrida tiene reservado el 100% de lo que necesita: materia
    prima Y cada insumo de etapa pendiente. Concepto exclusivo del flujo
    viejo (aprobacion de materiales) -- una orden del flujo nuevo no tiene
    total_required_material, no aplica."""
    if run.total_required_material is None:
        return False
    if run.reserved_material_quantity < run.total_required_material:
        return False
    for stage in run.stages:
        for ingredient in stage.ingredients:
            if ingredient.reserved_quantity < ingredient.quantity:
                return False
    return True


class ProductionDomainError(ValueError):
    pass


class ProductionNotFoundError(LookupError):
    pass


class ProductionService:
    def __init__(self, repository: ProductionProcessRepository, inventory_service: InventoryService | None = None) -> None:
        self.repository = repository
        self.inventory_service = inventory_service

    def _next_process_code(self) -> str:
        from sqlalchemy import select

        codes = self.repository.session.execute(select(ProductionProcess.code)).scalars().all()
        nums = [int(code) for code in codes if code and code.isdigit()]
        return str(max(nums) + 1 if nums else 2000)

    def _process_read(self, process: ProductionProcess) -> ProductionProcessRead:
        return ProductionProcessRead.model_validate(process)

    def _validate_run_products(
        self,
        process: ProductionProcess,
        quantity: Decimal,
        products: list,
    ) -> None:
        """Valida el plan de resultantes: tipos activos del catalogo o piezas
        existentes del inventario, sin repetidos y la suma debe cubrir la
        cantidad total."""
        keys = [p.product_type_id or p.target_item_id for p in products]
        if len(keys) != len(set(keys)):
            raise ProductionDomainError("No repitas el mismo producto resultante.")

        from backend.modules.product_types.models import ProductType
        from backend.modules.inventory.models import InventoryItem

        for product in products:
            if product.product_type_id is not None:
                product_type = self.repository.session.get(ProductType, product.product_type_id)
                if product_type is None or not product_type.is_active:
                    raise ProductionDomainError("Un producto resultante no existe o esta inactivo.")
            else:
                item = self.repository.session.get(InventoryItem, product.target_item_id)
                if item is None or item.item_type not in ("FINISHED_PRODUCT", "COMPLEMENT"):
                    raise ProductionDomainError(
                        "El destino seleccionado no existe como pieza en el inventario."
                    )
                if item.item_type == "FINISHED_PRODUCT":
                    if not item.product_code or len(item.product_code) != 7:
                        raise ProductionDomainError(
                            "La pieza destino debe tener un codigo de catalogo de 7 digitos."
                        )
                # COMPLEMENT: la joyeria fabrica su propio complemento; no
                # lleva codigo de catalogo (recetas/claves de modelo no aplican).

        total = sum((p.quantity for p in products), Decimal("0"))
        if total != quantity:
            raise ProductionDomainError(
                f"El plan de productos suma {total} y la orden fabrica {quantity}: deben coincidir."
            )

    def _material_coverage_ratio(self, lines: list[tuple["InventoryItem", Decimal]]) -> Decimal:
        """Minimo entre disponible/pedido de cada linea -- el recurso mas
        corto manda para TODAS las lineas por igual (si el complemento solo
        cubre 30%, la materia prima tambien arranca al 30%, no al 100%)."""
        if not lines:
            return Decimal("1")
        ratio = Decimal("1")
        for item, quantity in lines:
            available = self.inventory_service.available_stock(item)
            line_ratio = min(Decimal("1"), available / quantity) if quantity > 0 else Decimal("1")
            ratio = min(ratio, max(Decimal("0"), line_ratio))
        return ratio

    def create_process(self, payload: ProductionProcessCreate) -> ProductionProcessRead:
        process = ProductionProcess(
            name=payload.name,
            code=self._next_process_code(),
            description=payload.description,
            is_active=payload.is_active,
            quality_control=payload.quality_control,
        )
        self.repository.add(process)
        self.repository.flush()
        return self._process_read(process)

    def list_processes(self) -> list[ProductionProcessRead]:
        return [self._process_read(process) for process in self.repository.list()]

    def update_process(self, process_id: UUID, payload: ProductionProcessUpdate) -> ProductionProcessRead:
        process = self.repository.get(process_id)
        if process is None:
            raise ProductionNotFoundError("Proceso no encontrado.")

        process.name = payload.name
        process.description = payload.description
        process.is_active = payload.is_active
        process.quality_control = payload.quality_control
        self.repository.flush()
        return self._process_read(process)

    def delete_process(self, process_id: UUID) -> None:
        process = self.repository.get(process_id)
        if process is None:
            raise ProductionNotFoundError("Proceso no encontrado.")
        self.repository.delete(process)

    def seed_example_processes(self) -> None:
        """Siembra el banco de procesos de ejemplo SOLO en una base nueva (sin
        procesos). Nunca borra ni modifica datos existentes: si ya hay
        procesos, no hace nada, así el arranque jamás elimina lo que el
        usuario creó."""
        if self.repository.list():
            return

        for definition in EXAMPLE_PROCESSES:
            for stage in definition["stages"]:
                self.create_process(
                    ProductionProcessCreate(name=stage["name"], description=stage.get("description"))
                )

    def update_run_products(
        self, run_id: UUID, payload: RunProductsUpdate, current_user: CurrentUser
    ) -> ProductionRunRead:
        run = self.repository.get_run(run_id)
        if run is None:
            raise ProductionNotFoundError("Orden de produccion no encontrada.")
        if run.status in (ProductionRunStatus.RECEIVED, ProductionRunStatus.CANCELLED):
            raise ProductionDomainError(
                "El plan de productos ya no se puede cambiar: la orden fue recibida o cancelada."
            )
        process = self.repository.get(run.process_id)
        if process is None:
            raise ProductionNotFoundError("Proceso de la orden no encontrado.")
        self._validate_run_products(process, run.quantity, payload.products)
        run.products = [
            ProductionRunProduct(
                product_type_id=product.product_type_id,
                target_item_id=product.target_item_id,
                quantity=product.quantity,
                line_order=line_order,
            )
            for line_order, product in enumerate(payload.products)
        ]
        self.repository.flush()
        return self._read_with_names(run)

    def _cancel_run_core(self, run: ProductionRun, current_user: CurrentUser, reason: str | None) -> None:
        """Nucleo de la cancelacion: libera cualquier reserva y devuelve al
        inventario todo lo que la corrida ya consumio (materia prima,
        insumos), y la marca CANCELADA. Sin el chequeo de "hijo activo" --
        lo usa tanto cancel_run (una corrida sola, ese chequeo si aplica) como
        cancel_run_family (todas las corridas de la familia juntas, donde el
        chequeo no tiene sentido: se estan cancelando todas a la vez)."""
        if run.status == ProductionRunStatus.WAITING_MATERIAL:
            run.reserved_material_quantity = Decimal("0")

        # reverse_production_consumption suma los movimientos
        # CONSUMO_PRODUCCION con reference_id=run.id -- si no hay ninguno no
        # hace nada, es seguro llamarlo siempre (antes solo se llamaba si
        # materials_approved_at, un campo exclusivo del flujo viejo; el flujo
        # nuevo tambien puede haber consumido via start_stage_attempt/
        # allocate_stage_attempt_material y con ese gate esa reversion no
        # pasaba).
        if self.inventory_service is None:
            raise ProductionDomainError("Inventario no esta disponible para revertir el consumo de esta orden.")
        revert_reason = (
            f"Reversion por cancelacion de orden {run.production_code or run.id}."
            + (f" {reason}" if reason else "")
        )
        self.inventory_service.reverse_production_consumption(run.id, current_user.id, reason=revert_reason)
        # Si la orden ya llego a TERMINADA (assign_product convirtio el lote a
        # producto/complemento del catalogo), tambien hay que deshacer esa
        # conversion -- si no, cancelar la dejaria "cancelada" en produccion
        # pero el producto seguiria de alta en inventario como si nada.
        # No-op si la orden nunca genero un lote. Si el destino ya se movio de
        # ahi, esto lanza ProductionDomainError (via InventoryDomainError) y
        # bloquea la cancelacion entera -- ver reverse_finished_product_lot.
        try:
            self.inventory_service.reverse_finished_product_lot(run.id, current_user.id, reason=revert_reason)
        except InventoryDomainError as exc:
            raise ProductionDomainError(
                f"No se puede cancelar: {exc} Parte de lo producido ya se movio en inventario."
            ) from exc

        self._revert_admin_stock_lines(run, current_user)

        run.status = ProductionRunStatus.CANCELLED
        run.rejected_by_user_id = current_user.id
        run.rejection_reason = reason
        run.rejected_at = datetime.utcnow()
        run.is_cancellation = True

    def _revert_admin_stock_lines(self, run: ProductionRun, current_user: CurrentUser) -> None:
        """Lineas ADMIN_STOCK mueven stock por su propio rastro
        (reference_type="production_run_acta_line"), fuera de
        reverse_production_consumption -- cualquier camino que cancele la
        orden las revierte a cero igual, sin importar si llego a aprobar
        materiales (una linea de admin puede existir en casi cualquier estado
        de la orden, incluido PENDIENTE_INVENTARIO via reject_materials)."""
        for line in run.acta_lines:
            if line.source == ActaLineSource.ADMIN_STOCK and line.item_id is not None:
                if self.inventory_service is None:
                    raise ProductionDomainError(
                        "Inventario no esta disponible para revertir el consumo de esta orden."
                    )
                self._apply_admin_acta_line_delta(line, Decimal("0"), current_user)

    def cancel_run(self, run_id: UUID, current_user: CurrentUser, reason: str | None) -> ProductionRunRead:
        """Cancela una orden por error (etapa aceptada por equivocacion, dato mal
        tipeado, etc.): libera cualquier reserva y devuelve al inventario todo lo
        que la orden ya consumio (materia prima, insumos). No borra
        la fila -- igual criterio que InventoryService.delete_item: una orden con
        movimientos no se borra, se cancela, para no perder la trazabilidad del
        error ni romper actas/reportes que ya la referencian. El motivo es
        opcional -- no toda cancelacion tiene (o necesita) una explicacion."""
        reason = (reason or "").strip() or None
        run = self.repository.get_run(run_id)
        if run is None:
            raise ProductionNotFoundError("Orden de produccion no encontrada.")
        if run.status == ProductionRunStatus.RECEIVED:
            raise ProductionDomainError(
                "No se puede cancelar una orden ya recibida (ya se convirtio en producto terminado)."
            )
        if run.status == ProductionRunStatus.CANCELLED:
            raise ProductionDomainError("Esta orden ya esta cancelada.")

        from sqlalchemy import select

        active_child = self.repository.session.execute(
            select(ProductionRun.id).where(
                ProductionRun.parent_run_id == run.id,
                ProductionRun.status != ProductionRunStatus.CANCELLED,
            )
        ).first()
        if active_child is not None:
            raise ProductionDomainError(
                "Esta orden tiene una corrida hija activa (se dividio por falta de material). "
                "Cancela primero esa corrida hija, o cancela toda la familia junta desde 'Cancelar todo'."
            )

        self._cancel_run_core(run, current_user, reason)
        self.repository.flush()
        return self._read_with_names(run)

    def cancel_run_family(
        self, run_id: UUID, current_user: CurrentUser, reason: str | None
    ) -> list[ProductionRunRead]:
        """Cancela TODA la familia de una orden dividida (la raiz y cada corrida
        hija) de una sola vez, sin importar en que estado quedo cada una -- una
        corrida ya EN_PROCESO y su hermana todavia ESPERANDO_MATERIAL se
        cancelan juntas, revirtiendo a inventario lo que cada una ya haya
        consumido. Existe para el caso donde un split arranco solo una parte y
        el resto ya no tiene sentido seguir esperando: cancelar la raiz sola
        (cancel_run) lo bloquea el chequeo de "hijo activo"; esta funcion no
        lo tiene porque cancela a todos de una."""
        reason = (reason or "").strip() or None
        run = self.repository.get_run(run_id)
        if run is None:
            raise ProductionNotFoundError("Orden de produccion no encontrada.")

        root_code = run.root_production_code or run.production_code
        from sqlalchemy import or_, select

        family = (
            self.repository.session.execute(
                select(ProductionRun).where(
                    or_(
                        ProductionRun.production_code == root_code,
                        ProductionRun.root_production_code == root_code,
                    )
                )
            )
            .scalars()
            .all()
            if root_code is not None
            else [run]
        )
        if not family:
            family = [run]

        cancellable = [
            member
            for member in family
            if member.status not in (ProductionRunStatus.CANCELLED, ProductionRunStatus.RECEIVED)
        ]
        if not cancellable:
            raise ProductionDomainError("No hay ninguna parte de esta orden que se pueda cancelar.")

        for member in cancellable:
            self._cancel_run_core(member, current_user, reason)
        self.repository.flush()
        return [self._read_with_names(member) for member in cancellable]

    def _attach_allowed_types(self, reads: list, runs: list) -> None:
        """El banco de procesos (seccion 3) ya no restringe que tipos de
        producto puede producir cada proceso -- siempre vacio (= todos los
        tipos permitidos). Se mantiene el campo por compatibilidad con el
        combo de conversion del frontend."""
        for read in reads:
            read.allowed_product_type_ids = []

    def _attach_supply_consumptions(self, reads: list, runs: list) -> None:
        """Insumos consumidos por cada orden (movimientos CONSUMO_PRODUCCION que
        no son la materia prima principal). Alimenta el acta de entrega."""
        from sqlalchemy import select
        from backend.modules.inventory.models import InventoryItem, InventoryMovement

        run_ids = [run.id for run in runs]
        if not run_ids:
            return
        movements = self.repository.session.execute(
            select(InventoryMovement).where(
                InventoryMovement.movement_type == "CONSUMO_PRODUCCION",
                InventoryMovement.reference_id.in_(run_ids),
            )
        ).scalars().all()
        item_ids = list({m.item_id for m in movements})
        names = {}
        if item_ids:
            rows = self.repository.session.execute(
                select(InventoryItem.id, InventoryItem.name).where(InventoryItem.id.in_(item_ids))
            ).all()
            names = {row[0]: row[1] for row in rows}
        by_run: dict = {}
        for movement in movements:
            by_run.setdefault(movement.reference_id, []).append(movement)
        for read, run in zip(reads, runs):
            # Sumado por item: dos aprobaciones del mismo insumo (ej. material
            # adicional pedido dos veces) son UN insumo con mas cantidad, no
            # dos filas separadas -- asi el acta y el picker de "Entregar
            # material" ven el total real disponible.
            totals: dict = {}
            for m in by_run.get(run.id, []):
                if m.item_id == run.raw_material_item_id:
                    continue
                entry = totals.setdefault(m.item_id, {"quantity": Decimal("0"), "unit_code": m.unit_code})
                entry["quantity"] += m.quantity
            read.supply_consumptions = [
                SupplyConsumptionRead(
                    item_id=item_id,
                    name=names.get(item_id, "Insumo"),
                    quantity=entry["quantity"],
                    unit_code=entry["unit_code"],
                )
                for item_id, entry in totals.items()
            ]

    def _attach_plan_names(self, reads: list, runs: list) -> None:
        """Nombres del plan de resultantes (tipo de producto o pieza destino),
        para las vistas y el acta."""
        from sqlalchemy import select
        from backend.modules.inventory.models import InventoryItem
        from backend.modules.product_types.models import ProductType

        type_ids = {p.product_type_id for run in runs for p in run.products if p.product_type_id}
        target_item_ids = {p.target_item_id for run in runs for p in run.products if p.target_item_id}
        item_ids = set(target_item_ids)
        type_names: dict = {}
        if type_ids:
            rows = self.repository.session.execute(
                select(ProductType.id, ProductType.name).where(ProductType.id.in_(type_ids))
            ).all()
            type_names = {row[0]: row[1] for row in rows}
        item_names: dict = {}
        target_names: dict = {}
        item_units: dict = {}
        if item_ids:
            rows = self.repository.session.execute(
                select(
                    InventoryItem.id, InventoryItem.name, InventoryItem.description, InventoryItem.unit_code
                ).where(InventoryItem.id.in_(item_ids))
            ).all()
            for item_id, name, description, unit_code in rows:
                item_names[item_id] = name
                target_names[item_id] = (description or "").strip() or name
                item_units[item_id] = unit_code
        for read in reads:
            for product in read.products:
                if product.product_type_id is not None:
                    product.product_name = type_names.get(product.product_type_id)
                else:
                    product.product_name = target_names.get(product.target_item_id)
                    product.unit_code = item_units.get(product.target_item_id)

    def _attach_acta_lines(self, reads: list, runs: list) -> None:
        """Nombres de etapa/usuario para las lineas de la acta persistida."""
        user_ids = [line.created_by_user_id for run in runs for line in run.acta_lines]
        user_names = _resolve_run_user_names(self.repository.session, user_ids)
        for read, run in zip(reads, runs):
            stages_by_id = {stage.id: stage for stage in run.stages}
            attempts_by_id = {attempt.id: attempt for attempt in run.stage_attempts}
            read.acta_lines = [
                ActaLineRead(
                    id=line.id,
                    side=line.side,
                    label=line.label,
                    quantity=line.quantity,
                    unit_code=line.unit_code,
                    item_id=line.item_id,
                    source=line.source,
                    stage_id=line.stage_id,
                    stage_attempt_id=line.stage_attempt_id,
                    stage_name=(
                        stages_by_id[line.stage_id].stage_name
                        if line.stage_id in stages_by_id
                        else attempts_by_id[line.stage_attempt_id].process_name
                        if line.stage_attempt_id in attempts_by_id
                        else None
                    ),
                    note=line.note,
                    created_by_name=(
                        user_names.get(str(line.created_by_user_id)) if line.created_by_user_id else None
                    ),
                    created_at=line.created_at,
                )
                for line in run.acta_lines
            ]

    def _attach_stage_attempts(self, reads: list, runs: list) -> None:
        """Intentos de etapa del flujo nuevo, con nombres resueltos y sus
        propias lineas de acta (ver _attach_acta_lines para el detalle de
        cada linea -- aca solo se filtra por intento)."""
        from sqlalchemy import select
        from backend.modules.inventory.models import InventoryItem
        from backend.modules.product_types.models import ProductType

        user_ids = [
            uid
            for run in runs
            for attempt in run.stage_attempts
            for uid in (attempt.started_by_user_id, attempt.finished_by_user_id)
        ]
        user_names = _resolve_run_user_names(self.repository.session, user_ids)
        material_item_ids = list({
            m.item_id for run in runs for attempt in run.stage_attempts for m in attempt.materials
        })
        material_item_names: dict = {}
        if material_item_ids:
            rows = self.repository.session.execute(
                select(InventoryItem.id, InventoryItem.name).where(InventoryItem.id.in_(material_item_ids))
            ).all()
            material_item_names = {row[0]: row[1] for row in rows}
        target_item_ids = list({
            a.target_item_id for run in runs for a in run.stage_attempts if a.target_item_id
        })
        target_item_names: dict = {}
        if target_item_ids:
            rows = self.repository.session.execute(
                select(InventoryItem.id, InventoryItem.name).where(InventoryItem.id.in_(target_item_ids))
            ).all()
            target_item_names = {row[0]: row[1] for row in rows}
        target_type_ids = list({
            a.target_product_type_id for run in runs for a in run.stage_attempts if a.target_product_type_id
        })
        target_type_names: dict = {}
        if target_type_ids:
            rows = self.repository.session.execute(
                select(ProductType.id, ProductType.name).where(ProductType.id.in_(target_type_ids))
            ).all()
            target_type_names = {row[0]: row[1] for row in rows}
        for read, run in zip(reads, runs):
            acta_lines_by_read = {line.id: line for line in read.acta_lines}
            read.stage_attempts = [
                StageAttemptRead(
                    id=attempt.id,
                    run_id=attempt.run_id,
                    process_id=attempt.process_id,
                    process_name=attempt.process_name,
                    sequence_order=attempt.sequence_order,
                    attempt_no_for_process=attempt.attempt_no_for_process,
                    code=attempt.code,
                    responsable_name=attempt.responsable_name,
                    status=attempt.status,
                    rejection_reason=attempt.rejection_reason,
                    peso_al_finalizar=attempt.peso_al_finalizar,
                    unit_code=attempt.unit_code,
                    merma_weight=attempt.merma_weight,
                    merma_percent=attempt.merma_percent,
                    target_product_type_id=attempt.target_product_type_id,
                    target_item_id=attempt.target_item_id,
                    target_label=(
                        target_item_names.get(attempt.target_item_id)
                        if attempt.target_item_id
                        else target_type_names.get(attempt.target_product_type_id)
                    ),
                    started_by_name=(
                        user_names.get(str(attempt.started_by_user_id)) if attempt.started_by_user_id else None
                    ),
                    started_at=attempt.started_at,
                    finished_by_name=(
                        user_names.get(str(attempt.finished_by_user_id)) if attempt.finished_by_user_id else None
                    ),
                    finished_at=attempt.finished_at,
                    acta_lines=[
                        acta_lines_by_read[line.id]
                        for line in run.acta_lines
                        if line.stage_attempt_id == attempt.id and line.id in acta_lines_by_read
                    ],
                    materials=[
                        StageAttemptMaterialRead(
                            item_id=m.item_id,
                            name=material_item_names.get(m.item_id),
                            unit_code=m.unit_code,
                            quantity_requested=m.quantity_requested,
                            quantity_pending=m.quantity_pending,
                        )
                        for m in attempt.materials
                    ],
                )
                for attempt in sorted(run.stage_attempts, key=lambda a: a.sequence_order)
            ]

    def _add_or_merge_acta_line(
        self,
        run: ProductionRun,
        *,
        side: str,
        label: str,
        quantity: Decimal,
        unit_code: str,
        source: str,
        item_id: UUID | None = None,
        stage_id: UUID | None = None,
        stage_attempt_id: UUID | None = None,
        note: str | None = None,
        created_by_user_id: UUID | None = None,
    ) -> None:
        """Si ya existe una linea del mismo lado y material, suma la cantidad
        ahi en vez de agregar otra fila -- volver a solicitar/registrar algo
        que ya esta en el acta es MAS de lo mismo, no un evento nuevo que
        merezca su propia linea.

        "El mismo material" se decide por item_id (identidad real de
        inventario) cuando se conoce -- dos items distintos pueden coincidir
        en nombre+unidad (ej. una materia prima y un insumo ambos llamados
        igual) y NO son lo mismo. Solo cuando no hay item_id (linea libre)
        se cae al match por texto, y unicamente contra otras lineas
        igualmente libres."""
        if item_id is not None:
            existing = next(
                (
                    line
                    for line in run.acta_lines
                    if line.side == side
                    and line.item_id == item_id
                    and line.source != ActaLineSource.ADMIN_STOCK
                    and line.stage_attempt_id == stage_attempt_id
                ),
                None,
            )
        else:
            existing = next(
                (
                    line
                    for line in run.acta_lines
                    if line.side == side
                    and line.item_id is None
                    and line.label == label
                    and line.unit_code == unit_code
                    and line.source != ActaLineSource.ADMIN_STOCK
                    and line.stage_attempt_id == stage_attempt_id
                ),
                None,
            )
        if existing is not None:
            existing.quantity += quantity
            return
        line_order = sum(1 for line in run.acta_lines if line.side == side)
        run.acta_lines.append(
            ProductionRunActaLine(
                side=side,
                stage_id=stage_id,
                stage_attempt_id=stage_attempt_id,
                label=label,
                quantity=quantity,
                unit_code=unit_code,
                item_id=item_id,
                source=source,
                line_order=line_order,
                note=note,
                created_by_user_id=created_by_user_id,
            )
        )

    def _apply_admin_acta_line_delta(
        self, line: ProductionRunActaLine, new_quantity: Decimal, current_user: CurrentUser
    ) -> None:
        """Aplica solo la diferencia entre lo que ya se movio para esta linea
        y `new_quantity` -- nunca edita un movimiento existente (todo cambio
        de stock nace de un InventoryMovement nuevo). Se usa al crear la
        linea (new_quantity = cantidad completa, nada movido todavia), al
        editar su cantidad, y al borrarla (new_quantity = 0, revierte el
        neto). No hace nada si la linea no tiene item_id (linea libre)."""
        if line.item_id is None:
            return
        increase_type = "CONSUMO_PRODUCCION" if line.side == ActaLineSide.ENTREGA else "DEVOLUCION_PRODUCCION"
        decrease_type = "DEVOLUCION_PRODUCCION" if line.side == ActaLineSide.ENTREGA else "CONSUMO_PRODUCCION"

        from sqlalchemy import select
        from backend.modules.inventory.models import InventoryMovement

        moved = self.repository.session.execute(
            select(InventoryMovement.movement_type, InventoryMovement.quantity).where(
                InventoryMovement.reference_type == "production_run_acta_line",
                InventoryMovement.reference_id == line.id,
            )
        ).all()
        net_so_far = sum(
            (qty if mtype == increase_type else -qty for mtype, qty in moved), Decimal("0")
        )
        delta = new_quantity - net_so_far
        if delta == 0:
            return
        movement_type = increase_type if delta > 0 else decrease_type
        run = line.run

        # CONSUMO_PRODUCCION esta exento del chequeo de reserva dentro de
        # create_movement (PRODUCTION_MOVEMENTS) porque approve_materials ya
        # libero la reserva de la propia orden antes de consumir. Esta linea
        # de admin no libera ninguna reserva -- si la dejamos pasar por esa
        # exencion, el admin podria comerse en silencio stock que otra orden
        # ESPERANDO_MATERIAL tiene reservado. Replica aca el mismo chequeo
        # que create_movement le aplica a cualquier otro movimiento negativo.
        if movement_type == "CONSUMO_PRODUCCION":
            from backend.modules.inventory.models import InventoryItem

            item = self.repository.session.get(InventoryItem, line.item_id)
            if item is not None:
                reserved = self.inventory_service.reserved_stock(item.id)
                next_stock = item.current_stock - abs(delta)
                if reserved > 0 and next_stock < reserved:
                    raise ProductionDomainError(
                        f"'{line.label}': hay {format_qty(reserved)} {item.unit_code} de '{item.name}' "
                        f"reservados para ordenes de produccion en espera. Disponible para esta salida: "
                        f"{format_qty(item.current_stock - reserved)} {item.unit_code}. "
                        "Libera la reserva desde la orden si necesitas usar ese stock."
                    )
        try:
            self.inventory_service.create_movement(
                InventoryMovementCreate(
                    item_id=line.item_id,
                    movement_type=movement_type,
                    quantity=abs(delta),
                    reason=f"Ajuste manual de administrador en acta: {line.label}.",
                    reference_type="production_run_acta_line",
                    reference_id=line.id,
                ),
                user_id=current_user.id,
                lot_code=run.production_code or run.root_production_code,
            )
        except InventoryDomainError as exc:
            raise ProductionDomainError(f"'{line.label}': {exc}") from exc

    def add_admin_acta_line(
        self, run_id: UUID, payload: AdminActaLineCreate, current_user: CurrentUser
    ) -> ProductionRunRead:
        """Boton de admin en la acta: agrega una linea en cualquier momento
        del proceso, con o sin item real de inventario. Con item_id mueve
        stock real de inmediato (sin aprobacion, ver
        _apply_admin_acta_line_delta); sin item_id es una linea libre igual
        que las MANUAL de siempre (nunca mueve stock). No reusa
        _add_or_merge_acta_line a proposito: cada correccion de admin es su
        propia fila, nunca se fusiona con una linea PLAN/AUTO existente del
        mismo item (eso le heredaria un source que no se puede borrar)."""
        run = self.repository.get_run(run_id)
        if run is None:
            raise ProductionNotFoundError("Orden de produccion no encontrada.")
        if run.event_lines:
            raise ProductionDomainError(
                "Esta orden ya tiene su acta cargada desde papel; no se pueden agregar lineas nuevas por este flujo."
            )

        if payload.item_id is None:
            if not payload.label or not payload.unit_code:
                raise ProductionDomainError("Escribe el detalle y la unidad de la linea.")
            line = ProductionRunActaLine(
                side=payload.side,
                label=payload.label.strip(),
                quantity=payload.quantity,
                unit_code=payload.unit_code.strip(),
                item_id=None,
                source=ActaLineSource.MANUAL,
                line_order=sum(1 for l in run.acta_lines if l.side == payload.side),
                note=(payload.note or "").strip() or None,
                created_by_user_id=current_user.id,
                stage_attempt_id=payload.stage_attempt_id,
            )
            run.acta_lines.append(line)
            self.repository.flush()
            return self._read_with_names(run)

        if self.inventory_service is None:
            raise ProductionDomainError("Inventario no esta disponible para agregar esta linea.")

        from backend.modules.inventory.models import InventoryItem

        item = self.repository.session.get(InventoryItem, payload.item_id)
        if item is None:
            raise ProductionNotFoundError("Item de inventario no encontrado.")

        if payload.side == ActaLineSide.RECEPCION and payload.stage_attempt_id is not None:
            if item.item_type == "RAW_MATERIAL":
                raise ProductionDomainError(
                    "La materia prima no se devuelve por aca -- ya paso a formar parte del producto resultante."
                )
            entregado = sum(
                (
                    l.quantity
                    for l in run.acta_lines
                    if l.side == ActaLineSide.ENTREGA
                    and l.item_id == item.id
                    and l.stage_attempt_id == payload.stage_attempt_id
                ),
                Decimal("0"),
            )
            if entregado <= 0:
                raise ProductionDomainError("Solo se puede recibir un material que ya se entrego en esta etapa.")
            recibido = sum(
                (
                    l.quantity
                    for l in run.acta_lines
                    if l.side == ActaLineSide.RECEPCION
                    and l.item_id == item.id
                    and l.stage_attempt_id == payload.stage_attempt_id
                ),
                Decimal("0"),
            )
            disponible = entregado - recibido
            if payload.quantity > disponible:
                raise ProductionDomainError(
                    f"La cantidad ({format_qty(payload.quantity)} {item.unit_code}) supera lo que en realidad "
                    f"se entrego para este material ({format_qty(disponible)} {item.unit_code})."
                )

        line = ProductionRunActaLine(
            side=payload.side,
            label=item.name,
            quantity=Decimal("0"),
            unit_code=item.unit_code,
            item_id=item.id,
            source=ActaLineSource.ADMIN_STOCK,
            line_order=sum(1 for l in run.acta_lines if l.side == payload.side),
            note=(payload.note or "").strip() or None,
            created_by_user_id=current_user.id,
            stage_attempt_id=payload.stage_attempt_id,
        )
        run.acta_lines.append(line)
        self.repository.flush()
        self._apply_admin_acta_line_delta(line, payload.quantity, current_user)
        line.quantity = payload.quantity
        self.repository.flush()
        return self._read_with_names(run)

    def add_acta_line(self, run_id: UUID, payload: ActaLineCreate, current_user: CurrentUser) -> ProductionRunRead:
        """Agrega a mano una linea a la acta -- disponible en cualquier etapa
        de la orden, y tambien despues de recibida."""
        run = self.repository.get_run(run_id)
        if run is None:
            raise ProductionNotFoundError("Orden de produccion no encontrada.")
        self._add_or_merge_acta_line(
            run,
            side=payload.side,
            label=payload.label.strip(),
            quantity=payload.quantity,
            unit_code=payload.unit_code.strip(),
            item_id=payload.item_id,
            stage_attempt_id=payload.stage_attempt_id,
            source=ActaLineSource.MANUAL,
            note=(payload.note or "").strip() or None,
            created_by_user_id=current_user.id,
        )
        self.repository.flush()
        return self._read_with_names(run)

    def update_acta_line(self, line_id: UUID, payload: ActaLineUpdate, current_user: CurrentUser) -> ProductionRunRead:
        """Edita una linea existente (de cualquier origen: plan, automatica o
        manual). Solo actualiza los campos que vengan en el payload."""
        line = self.repository.get_acta_line(line_id)
        if line is None:
            raise ProductionNotFoundError("Linea de acta no encontrada.")

        if line.source == ActaLineSource.ADMIN_STOCK:
            # Lineas de un intento de etapa (flujo nuevo) mueven inventario
            # directo sin ser admin-only (seccion 2.3: cualquiera del rol
            # fusionado opera el acta). El gate admin sigue aplicando solo al
            # boton "+" viejo (lineas de nivel de orden, stage_attempt_id nulo).
            if line.stage_attempt_id is None and current_user.role not in {"admin", "Admin"}:
                raise ProductionDomainError("Solo el administrador puede editar una linea enlazada a inventario.")
            if payload.label is not None or payload.unit_code is not None:
                raise ProductionDomainError(
                    "Esta linea esta enlazada a un item de inventario: el detalle y la unidad no se editan a mano."
                )
            if payload.quantity is not None:
                self._apply_admin_acta_line_delta(line, payload.quantity, current_user)
                line.quantity = payload.quantity
            if payload.note is not None:
                line.note = payload.note.strip() or None
            self.repository.flush()
            return self._read_with_names(line.run)

        if payload.quantity is not None and line.side == ActaLineSide.RECEPCION and line.item_id is not None:
            cap = self._acta_line_max_quantity(line)
            if cap is not None and payload.quantity > cap:
                raise ProductionDomainError(
                    f"La cantidad ({format_qty(payload.quantity)} {line.unit_code}) supera lo que en realidad "
                    f"se entrego para este material ({format_qty(cap)} {line.unit_code})."
                )
        if payload.label is not None:
            line.label = payload.label.strip()
        if payload.quantity is not None:
            line.quantity = payload.quantity
        if payload.unit_code is not None:
            line.unit_code = payload.unit_code.strip()
        if payload.note is not None:
            line.note = payload.note.strip() or None
        self.repository.flush()
        return self._read_with_names(line.run)

    def _acta_line_max_quantity(self, line: ProductionRunActaLine) -> Decimal | None:
        """Techo real para editar una linea RECEPCION ligada a un item (uso o
        devolucion de insumo): no puede quedar, sumada a las demas lineas
        RECEPCION del mismo item, por encima de lo que de verdad se le
        entrego a la orden. Materia prima queda fuera -- esa se corrige por
        edit_stage_weight, que ya tiene su propia regla. Si el item no es un
        insumo conocido de esta orden, no hay techo (linea libre, sin
        identidad de inventario real detras)."""
        run = line.run
        if line.item_id == run.raw_material_item_id:
            return None
        other_logged = sum(
            (
                other.quantity
                for other in run.acta_lines
                if other.id != line.id and other.side == line.side and other.item_id == line.item_id
            ),
            Decimal("0"),
        )
        from sqlalchemy import select
        from backend.modules.inventory.models import InventoryMovement

        delivered = self.repository.session.execute(
            select(InventoryMovement.quantity).where(
                InventoryMovement.movement_type == "CONSUMO_PRODUCCION",
                InventoryMovement.reference_id == run.id,
                InventoryMovement.item_id == line.item_id,
            )
        ).scalars().all()
        if not delivered:
            return None
        return max(Decimal("0"), sum(delivered, Decimal("0")) - other_logged)

    def delete_acta_line(self, line_id: UUID, current_user: CurrentUser) -> ProductionRunRead:
        """Borra una linea agregada a mano (libre o enlazada a inventario).
        Las lineas planeadas o generadas automaticamente por un evento real
        no se borran -- son el rastro de lo que de verdad paso; si estan
        mal, se editan, no se esconden. Si la linea esta enlazada a
        inventario (ADMIN_STOCK), revierte el stock neto antes de borrarla."""
        line = self.repository.get_acta_line(line_id)
        if line is None:
            raise ProductionNotFoundError("Linea de acta no encontrada.")
        if line.source not in (ActaLineSource.MANUAL, ActaLineSource.ADMIN_STOCK):
            raise ProductionDomainError("Solo se pueden borrar lineas agregadas a mano.")
        if line.source == ActaLineSource.ADMIN_STOCK:
            if line.stage_attempt_id is None and current_user.role not in {"admin", "Admin"}:
                raise ProductionDomainError("Solo el administrador puede borrar una linea enlazada a inventario.")
            self._apply_admin_acta_line_delta(line, Decimal("0"), current_user)
        run = line.run
        run.acta_lines.remove(line)
        self.repository.session.delete(line)
        self.repository.flush()
        return self._read_with_names(run)

    def _read_with_names(self, run: ProductionRun) -> ProductionRunRead:
        read = ProductionRunRead.model_validate(run)
        _populate_run_names(self.repository.session, [read], [run])
        self._attach_allowed_types([read], [run])
        self._attach_supply_consumptions([read], [run])
        self._attach_plan_names([read], [run])
        self._attach_acta_lines([read], [run])
        self._attach_stage_attempts([read], [run])
        read.reservation_is_complete = _reservation_is_complete(run)
        return read

    def list_runs(self) -> list[ProductionRunRead]:
        runs = self.repository.list_runs()
        reads = [ProductionRunRead.model_validate(run) for run in runs]
        _populate_run_names(self.repository.session, reads, runs)
        self._attach_allowed_types(reads, runs)
        self._attach_supply_consumptions(reads, runs)
        self._attach_plan_names(reads, runs)
        self._attach_acta_lines(reads, runs)
        self._attach_stage_attempts(reads, runs)
        for read, run in zip(reads, runs):
            read.reservation_is_complete = _reservation_is_complete(run)
        return reads

    # --- Flujo dinamico de produccion (docs/cambios-sistema-produccion.md
    # seccion 4): crear orden solo con nombre, elegir proceso del banco
    # etapa por etapa, acta directa sin aprobacion (seccion 2.3), asignar a
    # producto terminado en cualquier momento (seccion 4.3). ---

    def create_order(self, payload: ProductionOrderCreate, current_user: CurrentUser) -> ProductionRunRead:
        run = ProductionRun(
            name=payload.name.strip(),
            status=ProductionRunStatus.IN_PROGRESS,
            created_by_user_id=current_user.id,
            requested_at=datetime.utcnow(),
        )
        run.production_code = _generate_production_code(self.repository, datetime.utcnow().year)
        self.repository.add_run(run)
        self.repository.flush()
        return self._read_with_names(run)

    def start_stage_attempt(
        self, run_id: UUID, payload: StageAttemptCreate, current_user: CurrentUser
    ) -> ProductionRunRead:
        run = self.repository.get_run(run_id)
        if run is None:
            raise ProductionNotFoundError("Orden de produccion no encontrada.")
        if run.status != ProductionRunStatus.IN_PROGRESS:
            raise ProductionDomainError("Solo se puede iniciar una etapa en una orden en proceso.")
        # Secuencial simple (confirmado): una sola etapa activa a la vez.
        if self.repository.get_active_stage_attempt(run_id) is not None:
            raise ProductionDomainError(
                "Ya hay una etapa en curso para esta orden -- finalizala antes de iniciar otra."
            )

        process = self.repository.get(payload.process_id)
        if process is None:
            raise ProductionNotFoundError("Proceso no encontrado en el banco.")
        if not process.is_active:
            raise ProductionDomainError("El proceso no esta activo.")

        sequence_order = len(run.stage_attempts) + 1
        attempt_no = (
            self.repository.count_stage_attempts_for_process(run_id, process.id, process.name) + 1
        )
        order_code = run.production_code or run.root_production_code
        responsable = payload.responsable_name.strip()

        def _new_attempt(status: str, attempt_no_for_process: int, order_index: int) -> ProductionRunStageAttempt:
            attempt_code = (
                _stage_attempt_code_for(order_code, process.name, attempt_no_for_process) if order_code else None
            )
            new_attempt = ProductionRunStageAttempt(
                run_id=run.id,
                process_id=process.id,
                process_name=process.name,
                sequence_order=sequence_order + order_index,
                attempt_no_for_process=attempt_no_for_process,
                code=attempt_code,
                responsable_name=responsable,
                status=status,
                started_by_user_id=current_user.id,
                started_at=datetime.utcnow(),
            )
            run.stage_attempts.append(new_attempt)
            return new_attempt

        def _store_product_target(attempt: ProductionRunStageAttempt) -> None:
            """Producto resultante obligatorio al elegir la etapa: solo guarda
            el destino (que producto va a salir). La cantidad real y la
            conversion de inventario se hacen al finalizar la etapa (Rodrigo,
            2026-08-20 -- no debe salir pre-llena)."""
            attempt.target_product_type_id = payload.product.product_type_id
            attempt.target_item_id = payload.product.target_item_id

        if not payload.materials:
            new_attempt = _new_attempt(StageAttemptStatus.IN_PROGRESS, attempt_no, 0)
            _store_product_target(new_attempt)
            self.repository.flush()
            return self._read_with_names(run)

        from backend.modules.inventory.models import InventoryItem

        resolved: list[tuple[InventoryItem, Decimal]] = []
        for line in payload.materials:
            item = self.repository.session.get(InventoryItem, line.item_id)
            if item is None:
                raise ProductionNotFoundError("Un material declarado para la etapa no existe en inventario.")
            resolved.append((item, line.quantity))

        ratio = self._material_coverage_ratio(resolved)

        def _consume_line(attempt: ProductionRunStageAttempt, item: "InventoryItem", quantity: Decimal) -> None:
            self.inventory_service.consume_material_for_production(
                item_id=item.id,
                quantity=quantity,
                production_run_id=run.id,
                user_id=current_user.id,
                production_code=order_code,
                reason=f"Consumo en etapa {process.name} ({attempt.code or attempt.id}).",
            )
            self._add_or_merge_acta_line(
                run,
                side=ActaLineSide.ENTREGA,
                label=item.name,
                quantity=quantity,
                unit_code=item.unit_code,
                source=ActaLineSource.PLAN,
                item_id=item.id,
                stage_attempt_id=attempt.id,
                created_by_user_id=current_user.id,
            )

        if ratio >= 1:
            covered_attempt = _new_attempt(StageAttemptStatus.IN_PROGRESS, attempt_no, 0)
            for item, quantity in resolved:
                _consume_line(covered_attempt, item, quantity)
                covered_attempt.materials.append(
                    ProductionRunStageAttemptMaterial(
                        item_id=item.id,
                        unit_code=item.unit_code,
                        quantity_requested=quantity,
                        quantity_pending=Decimal("0"),
                    )
                )
            _store_product_target(covered_attempt)
        elif ratio <= 0:
            waiting_attempt = _new_attempt(StageAttemptStatus.WAITING_MATERIAL, attempt_no, 0)
            for item, quantity in resolved:
                waiting_attempt.materials.append(
                    ProductionRunStageAttemptMaterial(
                        item_id=item.id,
                        unit_code=item.unit_code,
                        quantity_requested=quantity,
                        quantity_pending=quantity,
                    )
                )
            _store_product_target(waiting_attempt)
        else:
            covered_attempt = _new_attempt(StageAttemptStatus.IN_PROGRESS, attempt_no, 0)
            waiting_attempt = _new_attempt(StageAttemptStatus.WAITING_MATERIAL, attempt_no + 1, 1)
            for item, quantity in resolved:
                covered_qty = (quantity * ratio).quantize(Decimal("0.0001"), rounding=ROUND_DOWN)
                remainder = quantity - covered_qty
                if covered_qty > 0:
                    _consume_line(covered_attempt, item, covered_qty)
                covered_attempt.materials.append(
                    ProductionRunStageAttemptMaterial(
                        item_id=item.id,
                        unit_code=item.unit_code,
                        quantity_requested=covered_qty,
                        quantity_pending=Decimal("0"),
                    )
                )
                waiting_attempt.materials.append(
                    ProductionRunStageAttemptMaterial(
                        item_id=item.id,
                        unit_code=item.unit_code,
                        quantity_requested=remainder,
                        quantity_pending=remainder,
                    )
                )
            _store_product_target(covered_attempt)

        self.repository.flush()
        return self._read_with_names(run)

    def finish_stage_attempt(
        self, attempt_id: UUID, payload: StageAttemptFinish, current_user: CurrentUser
    ) -> ProductionRunRead:
        attempt = self.repository.get_stage_attempt(attempt_id)
        if attempt is None:
            raise ProductionNotFoundError("Etapa no encontrada.")
        if attempt.status != StageAttemptStatus.IN_PROGRESS:
            raise ProductionDomainError("Solo se puede finalizar una etapa en curso.")
        run = attempt.run

        process = self.repository.get(attempt.process_id) if attempt.process_id else None
        quality_control = bool(process and process.quality_control)

        entrega_lines = [
            line
            for line in run.acta_lines
            if line.stage_attempt_id == attempt.id and line.side == ActaLineSide.ENTREGA
        ]
        recepcion_lines = [
            line
            for line in run.acta_lines
            if line.stage_attempt_id == attempt.id and line.side == ActaLineSide.RECEPCION
        ]
        if entrega_lines:
            attempt.unit_code = entrega_lines[0].unit_code

        # Producto resultante: el destino ya se eligio al iniciar la etapa
        # (start_stage_attempt); la cantidad real recien se sabe aca (Rodrigo,
        # 2026-08-20 -- no debe salir pre-llena del picker). Convierte el lote
        # y deja la linea RECEPCION del producto lista, pase lo que pase con
        # la decision de calidad (un producto rechazado igual se registra,
        # queda disponible para usarse en otra etapa despues).
        if self.inventory_service is None:
            raise ProductionDomainError("Inventario no esta disponible para finalizar esta etapa.")

        from backend.modules.inventory.models import InventoryItem
        from backend.modules.inventory.schemas import LotConversionCreate

        first_entrega = next(
            (line for line in run.acta_lines if line.side == ActaLineSide.ENTREGA and line.item_id is not None),
            None,
        )
        raw_material = (
            self.repository.session.get(InventoryItem, first_entrega.item_id)
            if first_entrega is not None else None
        )
        lot = self.inventory_service.get_or_create_finished_product_lot(
            run=run,
            quantity=payload.product_quantity,
            material_type=(raw_material.material_type or raw_material.name) if raw_material else None,
            purity=raw_material.purity if raw_material else None,
            received_by_user_id=current_user.id,
        )
        try:
            if attempt.target_item_id is not None:
                target = self.repository.session.get(InventoryItem, attempt.target_item_id)
                if target is not None and target.item_type == "COMPLEMENT":
                    self.inventory_service.convert_lot_to_complement(
                        lot.id, attempt.target_item_id, payload.product_quantity, user_id=current_user.id
                    )
                    target_id = attempt.target_item_id
                else:
                    conversion = LotConversionCreate(
                        target_item_id=attempt.target_item_id, quantity=payload.product_quantity
                    )
                    converted = self.inventory_service.convert_lot_to_product(
                        lot.id, conversion, user_id=current_user.id
                    )
                    target_id = converted.id
            else:
                conversion = LotConversionCreate(
                    product_type_id=attempt.target_product_type_id, quantity=payload.product_quantity
                )
                converted = self.inventory_service.convert_lot_to_product(
                    lot.id, conversion, user_id=current_user.id
                )
                target_id = converted.id
        except (InventoryDomainError, InventoryNotFoundError) as exc:
            raise ProductionDomainError(f"No se pudo convertir el lote al producto resultante: {exc}") from exc

        target_item = self.repository.session.get(InventoryItem, target_id)
        self._add_or_merge_acta_line(
            run,
            side=ActaLineSide.RECEPCION,
            label=target_item.name if target_item else "Producto",
            quantity=payload.product_quantity,
            unit_code=target_item.unit_code if target_item else "und",
            source=ActaLineSource.PLAN,
            item_id=target_id,
            stage_attempt_id=attempt.id,
            created_by_user_id=current_user.id,
        )

        decision = payload.decision if quality_control else "APROBADA"
        if decision == "RECHAZADA":
            attempt.status = StageAttemptStatus.REJECTED
            attempt.rejection_reason = (payload.rejection_reason or "").strip() or None
        else:
            attempt.status = StageAttemptStatus.APPROVED
            # Merma propia de ESTE intento: lo entregado menos lo recibido de
            # VUELTA del mismo item (sin peso_al_finalizar) -- nunca se
            # compara contra otro intento. La linea RECEPCION del producto
            # resultante (Task 3) es un item totalmente distinto a la materia
            # prima entregada (el producto terminado, no la materia prima) y
            # NO cuenta como "recuperado" -- solo cuenta lo devuelto del
            # MISMO item que se entrego (ej. sobrante agregado a mano).
            entrega_by_item: dict = {}
            for line in entrega_lines:
                entrega_by_item[line.item_id] = entrega_by_item.get(line.item_id, Decimal("0")) + line.quantity
            entrega_total = sum(entrega_by_item.values(), Decimal("0"))
            recepcion_matched = sum(
                (
                    line.quantity
                    for line in recepcion_lines
                    if line.item_id is not None and line.item_id in entrega_by_item
                ),
                Decimal("0"),
            )
            if entrega_total > 0:
                loss = max(Decimal("0"), entrega_total - recepcion_matched)
                attempt.merma_weight = loss
                attempt.merma_percent = loss / entrega_total * Decimal("100")

        attempt.finished_by_user_id = current_user.id
        attempt.finished_at = datetime.utcnow()
        self.repository.flush()
        return self._read_with_names(run)

    def allocate_stage_attempt_material(self, attempt_id: UUID, current_user: CurrentUser) -> ProductionRunRead:
        """Asigna stock recien disponible a un intento PENDIENTE_MATERIAL --
        consume lo que alcance ahora y, si queda 100% cubierto y no hay otro
        intento EN_PROCESO en la orden, lo arranca. Es la aprobacion manual
        puntual que reemplaza al viejo allocate_material, pero por intento de
        etapa en vez de por orden completa."""
        attempt = self.repository.get_stage_attempt(attempt_id)
        if attempt is None:
            raise ProductionNotFoundError("Intento de etapa no encontrado.")
        if attempt.status != StageAttemptStatus.WAITING_MATERIAL:
            raise ProductionDomainError("Solo se puede asignar material a un intento en PENDIENTE_MATERIAL.")
        run = attempt.run

        from backend.modules.inventory.models import InventoryItem

        pending_lines = [line for line in attempt.materials if line.quantity_pending > 0]
        resolved = [(self.repository.session.get(InventoryItem, line.item_id), line) for line in pending_lines]
        for item, line in resolved:
            if item is None:
                raise ProductionDomainError("Un material pendiente de este intento ya no existe en inventario.")

        ratio = self._material_coverage_ratio([(item, line.quantity_pending) for item, line in resolved])
        if ratio > 0:
            for item, line in resolved:
                covered_qty = (line.quantity_pending * ratio).quantize(Decimal("0.0001"), rounding=ROUND_DOWN)
                if covered_qty <= 0:
                    continue
                self.inventory_service.consume_material_for_production(
                    item_id=item.id,
                    quantity=covered_qty,
                    production_run_id=run.id,
                    user_id=current_user.id,
                    production_code=run.production_code or run.root_production_code,
                    reason=f"Material asignado a etapa {attempt.process_name} ({attempt.code or attempt.id}).",
                )
                self._add_or_merge_acta_line(
                    run,
                    side=ActaLineSide.ENTREGA,
                    label=item.name,
                    quantity=covered_qty,
                    unit_code=item.unit_code,
                    source=ActaLineSource.AUTO,
                    item_id=item.id,
                    stage_attempt_id=attempt.id,
                    created_by_user_id=current_user.id,
                )
                line.quantity_pending -= covered_qty

        if all(line.quantity_pending <= 0 for line in attempt.materials):
            if self.repository.get_active_stage_attempt(run.id) is None:
                attempt.status = StageAttemptStatus.IN_PROGRESS
                attempt.started_at = datetime.utcnow()

        self.repository.flush()
        return self._read_with_names(run)

    def finish_order(self, run_id: UUID, current_user: CurrentUser) -> ProductionRunRead:
        """Cierra la orden completa (Rodrigo, 2026-08-20): cada etapa ya
        declaro su propio producto resultante (seccion 4), asi que cerrar
        aca no mueve inventario -- solo marca la orden como terminada, para
        que deje de aparecer como "en curso" y quede en el historial. No se
        puede cerrar con una etapa todavia activa."""
        run = self.repository.get_run(run_id)
        if run is None:
            raise ProductionNotFoundError("Orden de produccion no encontrada.")
        if run.status != ProductionRunStatus.IN_PROGRESS:
            raise ProductionDomainError("Solo se puede finalizar una orden en proceso.")
        if self.repository.get_active_stage_attempt(run_id) is not None:
            raise ProductionDomainError("Finaliza la etapa en curso antes de finalizar la orden.")

        run.status = ProductionRunStatus.FINISHED
        run.finished_at = datetime.utcnow()
        run.received_at = datetime.utcnow()
        run.received_by_user_id = current_user.id
        self.repository.flush()
        return self._read_with_names(run)

