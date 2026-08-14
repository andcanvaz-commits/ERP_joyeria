from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, select

from backend.modules.config.settings import settings
from backend.modules.inventory.models import ComplementType, InventoryItem, InventoryMovement
from backend.modules.inventory.repository import InventoryRepository
from backend.modules.inventory.schemas import (
    ComplementTypeCreate,
    ComplementTypeRead,
    InventoryItemCreate,
    InventoryItemRead,
    InventoryItemUpdate,
    InventoryMovementCreate,
    InventoryMovementRead,
    InventorySummary,
    LotConversionCreate,
    ProductCombineCreate,
)
from backend.modules.shared.contracts.inventory import (
    InventoryAvailabilityLine,
    InventoryAvailabilityResult,
    InventoryIntegrationPort,
    ProductionMaterialRequirement,
)


def _resolve_user_names(session, user_ids: list) -> dict:
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


def _generate_lot_code(repository: "InventoryRepository", material_label: str, item_id, year: int) -> str:
    # Prefijo = abreviatura del tipo de material (ej. "Plata" -> "PL", "AG" -> "AG").
    prefix = "".join(c for c in (material_label or "").upper() if c.isalnum())[:2] or "XX"
    year_short = str(year)[-2:]
    seq = repository.count_entrada_movements_for_item_this_year(item_id, year) + 1
    return f"LOT-{prefix}-{year_short}{seq:04d}"


class InventoryDomainError(ValueError):
    pass


class InventoryNotFoundError(LookupError):
    pass


POSITIVE_MOVEMENTS = {
    "ENTRADA", "AJUSTE_POSITIVO", "INGRESO_PRODUCCION", "DEVOLUCION_PRODUCCION",
    "CONVERSION_ENTRADA", "RECLASIFICACION_ENTRADA", "REVERSION_PRODUCCION",
}
NEGATIVE_MOVEMENTS = {"SALIDA", "AJUSTE_NEGATIVO", "CONSUMO_PRODUCCION", "MERMA", "CONVERSION_SALIDA", "RECLASIFICACION_SALIDA"}
# Salidas que nacen del propio flujo de produccion: no se les aplica el tope
# por stock reservado porque approve_materials ya libero la reserva de la
# corrida antes de consumir (ver ProductionService.approve_materials).
PRODUCTION_MOVEMENTS = {"CONSUMO_PRODUCCION"}
ITEM_TYPE_PREFIXES = {
    "RAW_MATERIAL": "MP",
    "SUPPLY": "IN",
    "COMPLEMENT": "CO",
    "WORK_IN_PROGRESS": "PP",
    "FINISHED_PRODUCT": "PT",
    "WASTE": "ME",
}

# Tipos que el usuario gestiona directamente (crear/editar/eliminar);
# los demás los administra el flujo de producción.
MANUALLY_MANAGED_TYPES = ("RAW_MATERIAL", "SUPPLY", "COMPLEMENT", "FINISHED_PRODUCT")


class InventoryService(InventoryIntegrationPort):
    def __init__(self, repository: InventoryRepository) -> None:
        self.repository = repository

    def create_item(self, payload: InventoryItemCreate) -> InventoryItemRead:
        if payload.item_type not in MANUALLY_MANAGED_TYPES:
            raise InventoryDomainError(
                "Solo se pueden crear manualmente materias primas, insumos o productos terminados."
            )
        item = InventoryItem(
            item_type=payload.item_type,
            name=payload.name,
            sku=self._generate_sku(payload.item_type),
            description=payload.description,
            material_type=payload.material_type,
            purity=payload.purity,
            total_weight=payload.total_weight,
            elaboration_date=payload.elaboration_date,
            unit_code=payload.unit_code.strip(),
            minimum_stock=payload.minimum_stock,
            complement_type_id=self._resolve_complement_type_id(payload.item_type, payload.complement_type_id),
        )
        self.repository.add_item(item)
        self.repository.flush()
        return InventoryItemRead.model_validate(item)

    def update_item(self, item_id: UUID, payload: InventoryItemUpdate) -> InventoryItemRead:
        item = self._get_item_or_raise(item_id)
        editable = MANUALLY_MANAGED_TYPES
        if item.item_type not in editable or payload.item_type not in editable:
            raise InventoryDomainError(
                "Solo se pueden editar manualmente materias primas, insumos o productos terminados."
            )

        item.item_type = payload.item_type
        item.name = payload.name
        item.description = payload.description
        item.material_type = payload.material_type
        item.purity = payload.purity
        item.total_weight = payload.total_weight
        item.elaboration_date = payload.elaboration_date
        item.unit_code = payload.unit_code.strip()
        item.minimum_stock = payload.minimum_stock
        # Solo si el cliente lo mandó explícitamente: los formularios de
        # edición existentes no envían el campo y no deben vaciarlo.
        if "weight_per_unit" in payload.model_fields_set:
            item.weight_per_unit = payload.weight_per_unit
        # Igual que weight_per_unit: solo tocar complement_type_id si el
        # cliente lo mandó explícitamente, salvo que el item deje de ser
        # COMPLEMENT (en cuyo caso siempre se limpia).
        if payload.item_type != "COMPLEMENT":
            item.complement_type_id = None
        elif "complement_type_id" in payload.model_fields_set:
            item.complement_type_id = self._resolve_complement_type_id(
                payload.item_type, payload.complement_type_id
            )
        self.repository.flush()
        return InventoryItemRead.model_validate(item)

    def delete_item(self, item_id: UUID) -> None:
        item = self._get_item_or_raise(item_id)
        if item.item_type not in MANUALLY_MANAGED_TYPES:
            raise InventoryDomainError("Solo se pueden eliminar materias primas, insumos o productos terminados.")
        if item.current_stock > 0:
            raise InventoryDomainError(
                "No se puede eliminar un item con stock. Deja el stock en cero primero."
            )
        # Los movimientos son el historial inmutable del item: si ya tiene
        # alguno, no se elimina el item (perderia ese historial). Solo se
        # puede eliminar un item que nunca tuvo movimientos (alta por error).
        # Si tuvo movimientos pero ya esta en cero, archivar en su lugar.
        if self.repository.list_movements(item_id):
            raise InventoryDomainError(
                "Este item tiene movimientos registrados: eliminarlo borraria su historial. "
                "Archívalo en su lugar."
            )
        self.repository.delete_item(item)

    def archive_item(self, item_id: UUID) -> InventoryItemRead:
        """Oculta un item agotado del inventario activo conservando su historial."""
        item = self._get_item_or_raise(item_id)
        if item.item_type not in MANUALLY_MANAGED_TYPES:
            raise InventoryDomainError("Solo se pueden archivar materias primas, insumos o productos terminados.")
        if item.current_stock > 0:
            raise InventoryDomainError("Solo se pueden archivar items agotados (stock en cero).")
        item.archived_at = datetime.now(timezone.utc)
        self.repository.flush()
        return InventoryItemRead.model_validate(item)

    def unarchive_item(self, item_id: UUID) -> InventoryItemRead:
        item = self._get_item_or_raise(item_id)
        item.archived_at = None
        self.repository.flush()
        return InventoryItemRead.model_validate(item)

    def revert_last_entry(self, item_id: UUID) -> InventoryItemRead | None:
        """Revierte SOLO la ultima entrada de lote registrada del item: la borra y
        recalcula el stock y el costo promedio replayando los movimientos restantes.
        Si la entrada revertida era el unico movimiento y el item nacio de una
        factura XML, el item tambien se elimina (retorna None): revertir la factura
        no debe dejar items vacios que nunca existieron antes de ella."""
        item = self._get_item_or_raise(item_id)
        movements = sorted(
            self.repository.list_movements(item_id), key=lambda m: m.created_at
        )
        if not movements:
            raise InventoryDomainError("No hay movimientos para revertir.")
        last = movements[-1]
        if last.movement_type != "ENTRADA":
            raise InventoryDomainError(
                "Solo se puede revertir la ultima entrada de lote registrada."
            )
        window_hours = settings.inventory_revert_window_hours
        created = last.created_at
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) - created > timedelta(hours=window_hours):
            raise InventoryDomainError(
                f"La entrada tiene mas de {window_hours} horas y ya no se puede revertir. "
                "Registra un ajuste de inventario."
            )
        self.repository.delete_movement(last)

        remaining = movements[:-1]
        if not remaining and (item.description or "").startswith("Creado desde factura XML."):
            self.repository.delete_item(item)
            self.repository.flush()
            return None

        stock = Decimal("0")
        avg = Decimal("0")
        for movement in remaining:
            if movement.movement_type == "ENTRADA" and movement.unit_cost is not None:
                total = stock + movement.quantity
                if total > 0:
                    avg = (stock * avg + movement.quantity * movement.unit_cost) / total
            stock += self._movement_delta(movement.movement_type, movement.quantity)
        item.current_stock = stock
        item.average_cost = avg
        self.repository.flush()
        return InventoryItemRead.model_validate(item)

    def reclassify_waste_movement(
        self, movement_id: UUID, target_item_id: UUID, quantity: Decimal | None, user_id: UUID | None,
    ) -> list[InventoryMovementRead]:
        movement = self.repository.get_movement(movement_id)
        if movement is None:
            raise InventoryNotFoundError("Movimiento no encontrado.")
        if movement.movement_type != "INGRESO_PRODUCCION" or movement.reference_type != "production_run":
            raise InventoryDomainError("Solo se puede reclasificar un ingreso de merma de produccion.")
        source_item = self._get_item_or_raise(movement.item_id)
        if source_item.item_type != "WASTE":
            raise InventoryDomainError("El movimiento no corresponde a un item de tipo merma.")
        target_item = self._get_item_or_raise(target_item_id)
        if target_item.item_type != "WASTE":
            raise InventoryDomainError("El item destino debe ser de tipo merma.")
        if target_item.id == source_item.id:
            raise InventoryDomainError("El item destino debe ser distinto al origen.")
        if target_item.unit_code != source_item.unit_code:
            raise InventoryDomainError(
                f"No se puede reclasificar: unidades distintas ({source_item.unit_code} vs {target_item.unit_code})."
            )

        move_quantity = quantity if quantity is not None else movement.quantity
        if move_quantity > source_item.current_stock:
            raise InventoryDomainError(
                f"Solo quedan {source_item.current_stock} {source_item.unit_code} de "
                f'"{source_item.name}" para reclasificar.'
            )

        salida = self.create_movement(
            InventoryMovementCreate(
                item_id=source_item.id,
                movement_type="RECLASIFICACION_SALIDA",
                quantity=move_quantity,
                reason=f"Reclasificado hacia {target_item.name}",
                reference_type=movement.reference_type,
                reference_id=movement.reference_id,
            ),
            user_id=user_id,
        )
        entrada = self.create_movement(
            InventoryMovementCreate(
                item_id=target_item.id,
                movement_type="RECLASIFICACION_ENTRADA",
                quantity=move_quantity,
                reason=f"Reclasificado desde {source_item.name}",
                reference_type=movement.reference_type,
                reference_id=movement.reference_id,
            ),
            user_id=user_id,
        )
        return [salida, entrada]

    # ------------------------------------------------------------------
    # Stock disponible = fisico - reservado
    #
    # FUENTE UNICA DE VERDAD para "¿alcanza?". `current_stock` es lo que hay
    # fisicamente en la bodega; `available_stock` es lo que se puede
    # comprometer. Todo lugar que decida disponibilidad debe usar estos
    # helpers -- si alguno lee `current_stock` a secas, dos ordenes pueden
    # comprometer el mismo gramo de oro.
    # ------------------------------------------------------------------

    def reserved_by_item(self, exclude_run_id: UUID | None = None) -> dict[UUID, Decimal]:
        """Cuanto stock esta reservado por corridas ESPERANDO_MATERIAL, por item.

        `exclude_run_id` deja fuera las reservas de una corrida puntual: al
        aprobarle materiales a esa corrida, su propia reserva SI esta
        disponible para ella (es justamente el stock que le guardamos).
        """
        from backend.modules.production.models import (
            ComplementRequestStatus,
            ProductionComplementRequest,
            ProductionRun,
            ProductionRunStatus,
        )

        totals: dict[UUID, Decimal] = {}

        material_query = select(
            ProductionRun.raw_material_item_id,
            func.sum(ProductionRun.reserved_material_quantity),
        ).where(
            ProductionRun.status == ProductionRunStatus.WAITING_MATERIAL,
            ProductionRun.reserved_material_quantity > 0,
            ProductionRun.raw_material_item_id.is_not(None),
        )
        if exclude_run_id is not None:
            material_query = material_query.where(ProductionRun.id != exclude_run_id)
        for item_id, total in self.repository.session.execute(
            material_query.group_by(ProductionRun.raw_material_item_id)
        ).all():
            totals[item_id] = totals.get(item_id, Decimal("0")) + (total or Decimal("0"))

        complement_query = (
            select(
                ProductionComplementRequest.item_id,
                func.sum(ProductionComplementRequest.reserved_quantity),
            )
            .join(ProductionRun, ProductionRun.id == ProductionComplementRequest.run_id)
            .where(
                ProductionRun.status == ProductionRunStatus.WAITING_MATERIAL,
                ProductionComplementRequest.status == ComplementRequestStatus.PENDING,
                ProductionComplementRequest.reserved_quantity > 0,
            )
        )
        if exclude_run_id is not None:
            complement_query = complement_query.where(ProductionRun.id != exclude_run_id)
        for item_id, total in self.repository.session.execute(
            complement_query.group_by(ProductionComplementRequest.item_id)
        ).all():
            totals[item_id] = totals.get(item_id, Decimal("0")) + (total or Decimal("0"))

        return totals

    def reserved_stock(self, item_id: UUID, exclude_run_id: UUID | None = None) -> Decimal:
        return self.reserved_by_item(exclude_run_id).get(item_id, Decimal("0"))

    def available_stock(self, item: InventoryItem, exclude_run_id: UUID | None = None) -> Decimal:
        """Lo que realmente se puede comprometer de este item."""
        reserved = self.reserved_stock(item.id, exclude_run_id)
        return item.current_stock - reserved

    def list_items(self, item_type: str | None = None) -> list[InventoryItemRead]:
        # Una sola agregacion para toda la lista (sin N+1 por item).
        reserved = self.reserved_by_item()
        reads = []
        for item in self.repository.list_items(item_type):
            read = InventoryItemRead.model_validate(item)
            read.reserved_stock = reserved.get(item.id, Decimal("0"))
            read.available_stock = item.current_stock - read.reserved_stock
            reads.append(read)
        return reads

    def create_movement(
        self, payload: InventoryMovementCreate, user_id: UUID | None, lot_code: str | None = None
    ) -> InventoryMovementRead:
        item = self._get_item_or_raise(payload.item_id)

        delta = self._movement_delta(payload.movement_type, payload.quantity)
        next_stock = item.current_stock + delta
        if next_stock < 0:
            raise InventoryDomainError("El movimiento dejaria el stock en negativo.")
        # Una salida no puede llevarse stock reservado para una orden: la
        # reserva existe justamente para que ese material siga ahi cuando la
        # orden arranque. El consumo de la propia produccion pasa por
        # consume_material_for_production, que libera la reserva antes.
        if delta < 0 and payload.movement_type not in PRODUCTION_MOVEMENTS:
            reserved = self.reserved_stock(item.id)
            if reserved > 0 and next_stock < reserved:
                raise InventoryDomainError(
                    f"Hay {reserved} {item.unit_code} de '{item.name}' reservados para "
                    f"ordenes de produccion en espera. Disponible para esta salida: "
                    f"{item.current_stock - reserved} {item.unit_code}. "
                    "Libera la reserva desde la orden si necesitas usar ese stock."
                )

        # Un movimiento sobre un item archivado lo reactiva: archivar nunca
        # bloquea entradas futuras (ej. reaparece en una factura XML).
        if item.archived_at is not None:
            item.archived_at = None

        movement = InventoryMovement(
            item_id=item.id,
            movement_type=payload.movement_type,
            quantity=payload.quantity,
            unit_code=item.unit_code,
            unit_cost=payload.unit_cost,
            reason=payload.reason,
            reference_type=payload.reference_type,
            reference_id=payload.reference_id,
            source_file_name=payload.source_file_name,
            source_file_mime=payload.source_file_mime,
            source_file_content=payload.source_file_content,
            created_by=user_id,
        )
        if lot_code:
            # Reusar el código de la orden de producción (no inventar otro).
            movement.lot_code = lot_code
        elif payload.movement_type == "ENTRADA":
            movement.lot_code = _generate_lot_code(
                self.repository,
                item.material_type or item.name,
                item.id,
                datetime.utcnow().year,
            )
        # Kardex promedio ponderado movil: al ingresar materia prima con costo,
        # el costo promedio del item se recalcula ponderando el stock anterior y
        # la nueva entrada. nuevo_prom = (stock*prom + cantidad*costo) / (stock+cantidad).
        if payload.movement_type == "ENTRADA" and payload.unit_cost is not None:
            previous_stock = item.current_stock
            previous_avg = item.average_cost or Decimal("0")
            incoming_total = previous_stock + payload.quantity
            if incoming_total > 0:
                item.average_cost = (
                    previous_stock * previous_avg + payload.quantity * payload.unit_cost
                ) / incoming_total

        item.current_stock = next_stock
        self.repository.add_movement(movement)
        self.repository.flush()
        return InventoryMovementRead.model_validate(movement)

    def ensure_production_item(self, *, item_type: str, name: str, unit_code: str) -> InventoryItem:
        existing = next(
            (
                item
                for item in self.repository.list_items(item_type)
                if item.name.strip().lower() == name.strip().lower()
            ),
            None,
        )
        if existing is not None:
            return existing

        item = InventoryItem(
            item_type=item_type,
            name=name,
            sku=self._generate_sku(item_type),
            description="Creado automaticamente desde produccion.",
            unit_code=unit_code.strip(),
            minimum_stock=None,
        )
        self.repository.add_item(item)
        self.repository.flush()
        return item

    def consume_material_for_production(
        self,
        *,
        item_id: UUID,
        quantity: Decimal,
        production_run_id: UUID,
        user_id: UUID | None,
        production_code: str | None = None,
        reason: str | None = None,
    ) -> InventoryMovementRead:
        payload = InventoryMovementCreate(
            item_id=item_id,
            movement_type="CONSUMO_PRODUCCION",
            quantity=quantity,
            reason=reason or "Consumo de materia prima por inicio de produccion.",
            reference_type="production_run",
            reference_id=production_run_id,
        )
        return self.create_movement(payload, user_id=user_id, lot_code=production_code)

    def return_material_from_production(
        self,
        *,
        item_id: UUID,
        quantity: Decimal,
        production_run_id: UUID,
        user_id: UUID | None,
        production_code: str | None = None,
        reason: str | None = None,
    ) -> InventoryMovementRead:
        payload = InventoryMovementCreate(
            item_id=item_id,
            movement_type="DEVOLUCION_PRODUCCION",
            quantity=quantity,
            reason=reason or "Devolucion de sobrante de produccion.",
            reference_type="production_run",
            reference_id=production_run_id,
        )
        return self.create_movement(payload, user_id=user_id, lot_code=production_code)

    def reverse_production_consumption(self, run_id: UUID, user_id: UUID | None, reason: str) -> None:
        """Restaura el stock de todo lo que una corrida consumio (materia prima,
        insumos por etapa, complementos): cubre los tres porque
        consume_material_for_production siempre guarda reference_id=run_id sin
        importar el item. No toca el costo promedio -- REVERSION_PRODUCCION no
        es ENTRADA, solo devuelve gramos/unidades al stock fisico."""
        movements = self.repository.session.execute(
            select(InventoryMovement).where(
                InventoryMovement.movement_type == "CONSUMO_PRODUCCION",
                InventoryMovement.reference_type == "production_run",
                InventoryMovement.reference_id == run_id,
            )
        ).scalars().all()
        consumed: dict[UUID, Decimal] = {}
        for movement in movements:
            consumed[movement.item_id] = consumed.get(movement.item_id, Decimal("0")) + movement.quantity
        for item_id, quantity in consumed.items():
            if quantity <= 0:
                continue
            self.create_movement(
                InventoryMovementCreate(
                    item_id=item_id,
                    movement_type="REVERSION_PRODUCCION",
                    quantity=quantity,
                    reason=reason,
                    reference_type="production_run",
                    reference_id=run_id,
                ),
                user_id=user_id,
            )

    def list_movements(self, item_id: UUID | None = None) -> list[InventoryMovementRead]:
        movements = self.repository.list_movements(item_id)
        user_names = _resolve_user_names(self.repository.session, [m.created_by for m in movements if m.created_by])
        result = []
        for movement in movements:
            read = InventoryMovementRead.model_validate(movement)
            if movement.created_by:
                read.created_by_name = user_names.get(str(movement.created_by))
            result.append(read)
        return result

    def get_movement_source_file(self, movement_id: UUID) -> tuple[str, str, str]:
        movement = self.repository.get_movement(movement_id)
        if movement is None:
            raise InventoryNotFoundError("Movimiento de inventario no encontrado.")
        if not movement.source_file_content or not movement.source_file_name:
            raise InventoryNotFoundError("El movimiento no tiene archivo XML asociado.")
        return (
            movement.source_file_name,
            movement.source_file_mime or "application/xml",
            movement.source_file_content,
        )

    def get_summary(self) -> InventorySummary:
        items = self.repository.list_items()
        # Stock bajo se mide contra lo DISPONIBLE: material reservado para una
        # orden en espera no sirve para cubrir el minimo.
        reserved = self.reserved_by_item()
        low_stock_items = sum(
            1
            for item in items
            if item.minimum_stock is not None
            and item.current_stock - reserved.get(item.id, Decimal("0")) <= item.minimum_stock
        )
        return InventorySummary(
            raw_materials=sum(1 for item in items if item.item_type == "RAW_MATERIAL"),
            supplies=sum(1 for item in items if item.item_type == "SUPPLY"),
            complements=sum(1 for item in items if item.item_type == "COMPLEMENT"),
            work_in_progress=sum(1 for item in items if item.item_type == "WORK_IN_PROGRESS"),
            finished_products=sum(1 for item in items if item.item_type == "FINISHED_PRODUCT"),
            low_stock_items=low_stock_items,
            total_items=len(items),
        )

    def list_complement_types(self) -> list[ComplementTypeRead]:
        rows = self.repository.session.execute(
            select(ComplementType).order_by(ComplementType.name.asc())
        ).scalars().all()
        return [ComplementTypeRead.model_validate(row) for row in rows]

    def create_complement_type(self, payload: ComplementTypeCreate) -> ComplementTypeRead:
        name = payload.name.strip()
        if self._get_complement_type_by_name(name) is not None:
            raise InventoryDomainError("Ya existe un tipo de complemento con ese nombre.")
        complement_type = ComplementType(name=name)
        self.repository.session.add(complement_type)
        self.repository.flush()
        return ComplementTypeRead.model_validate(complement_type)

    def update_complement_type(self, type_id: UUID, payload: ComplementTypeCreate) -> ComplementTypeRead:
        complement_type = self._get_complement_type_or_raise(type_id)
        name = payload.name.strip()
        existing = self._get_complement_type_by_name(name)
        if existing is not None and existing.id != complement_type.id:
            raise InventoryDomainError("Ya existe un tipo de complemento con ese nombre.")
        complement_type.name = name
        self.repository.flush()
        return ComplementTypeRead.model_validate(complement_type)

    def delete_complement_type(self, type_id: UUID) -> None:
        complement_type = self._get_complement_type_or_raise(type_id)
        in_use = self.repository.session.execute(
            select(func.count(InventoryItem.id)).where(
                InventoryItem.item_type == "COMPLEMENT",
                InventoryItem.complement_type_id == type_id,
            )
        ).scalar_one()
        if in_use:
            raise InventoryDomainError(
                "No se puede eliminar: hay complementos que usan este tipo."
            )
        self.repository.session.delete(complement_type)
        self.repository.flush()

    def _get_complement_type_by_name(self, name: str) -> ComplementType | None:
        return self.repository.session.execute(
            select(ComplementType).where(func.lower(ComplementType.name) == name.strip().lower())
        ).scalars().first()

    def _get_complement_type_or_raise(self, type_id: UUID) -> ComplementType:
        complement_type = self.repository.session.get(ComplementType, type_id)
        if complement_type is None:
            raise InventoryNotFoundError("Tipo de complemento no encontrado.")
        return complement_type

    def _resolve_complement_type_id(
        self, item_type: str, complement_type_id: UUID | None
    ) -> UUID | None:
        """Solo los items COMPLEMENT pueden tener tipo de complemento; para
        el resto del catálogo el campo se anula sin importar lo que venga."""
        if item_type != "COMPLEMENT" or complement_type_id is None:
            return None
        complement_type = self.repository.session.get(ComplementType, complement_type_id)
        if complement_type is None or not complement_type.is_active:
            raise InventoryDomainError("Tipo de complemento no encontrado o inactivo.")
        return complement_type_id

    def check_material_availability(
        self,
        requirements: tuple[ProductionMaterialRequirement, ...],
    ) -> InventoryAvailabilityResult:
        lines = []
        reserved = self.reserved_by_item()
        for requirement in requirements:
            item = self.repository.get_item(requirement.item_id)
            available = (
                item.current_stock - reserved.get(item.id, Decimal("0"))
                if item is not None
                else Decimal("0")
            )
            missing = max(Decimal("0"), requirement.quantity - available)
            lines.append(
                InventoryAvailabilityLine(
                    item_id=requirement.item_id,
                    required_quantity=requirement.quantity,
                    available_quantity=available,
                    missing_quantity=missing,
                )
            )
        return InventoryAvailabilityResult(
            has_enough_stock=all(line.missing_quantity == 0 for line in lines),
            lines=tuple(lines),
        )

    def reserve_materials_for_production(
        self,
        production_order_id: UUID,
        requirements: tuple[ProductionMaterialRequirement, ...],
    ) -> None:
        availability = self.check_material_availability(requirements)
        if not availability.has_enough_stock:
            raise InventoryDomainError("No hay stock suficiente para reservar materiales.")

    def create_finished_product_lot(
        self,
        *,
        name: str,
        unit_code: str,
        production_order_id: UUID,
        production_code: str | None,
        quantity: Decimal,
        product_code: str | None = None,
        material_type: str | None = None,
        purity: str | None = None,
        received_by_user_id: UUID | None = None,
    ) -> InventoryItem:
        """Crea un producto terminado POR ORDEN (lote), identificado por el código OP,
        con el código de producto (codificación). Cada orden es su propio lote."""
        sku = (production_code or "").strip() or self._generate_sku("FINISHED_PRODUCT")
        if self.repository.get_item_by_sku(sku) is not None:
            sku = self._generate_sku("FINISHED_PRODUCT")
        # El lote guarda sus gramos por unidad (peso final de la orden entre
        # unidades) para que los historiales muestren la equivalencia en peso.
        from sqlalchemy import select
        from backend.modules.production.models import ProductionRun

        run = self.repository.session.execute(
            select(ProductionRun).where(ProductionRun.production_code == sku)
        ).scalar_one_or_none()
        run_info = self._run_grams_per_unit(run) if run is not None else None
        item = InventoryItem(
            item_type="FINISHED_PRODUCT",
            name=name,
            sku=sku,
            product_code=product_code,
            description="Producto terminado de produccion.",
            material_type=material_type,
            purity=purity,
            unit_code=unit_code.strip(),
            weight_per_unit=run_info[0] if run_info else None,
            minimum_stock=None,
        )
        self.repository.add_item(item)
        self.repository.flush()
        payload = InventoryMovementCreate(
            item_id=item.id,
            movement_type="INGRESO_PRODUCCION",
            quantity=quantity,
            reason="Ingreso de producto terminado desde produccion.",
            reference_type="production_order",
            reference_id=production_order_id,
        )
        self.create_movement(payload, user_id=received_by_user_id, lot_code=production_code)
        return item

    def _resolve_catalog_target(self, material_code: str, product_type_id: UUID):
        """Valida material y tipo de producto del catálogo y devuelve
        (product_code, product_type). Compartido por conversión y ensamble."""
        from sqlalchemy import select
        from backend.modules.catalog.models import CatalogSegment
        from backend.modules.product_types.models import ProductType

        session = self.repository.session
        material = session.execute(
            select(CatalogSegment).where(
                CatalogSegment.kind == "MATERIAL",
                CatalogSegment.code == material_code,
                CatalogSegment.is_active.is_(True),
            )
        ).scalar_one_or_none()
        if material is None:
            raise InventoryDomainError("Material no existe en el catalogo.")
        product_type = session.get(ProductType, product_type_id)
        if product_type is None or not product_type.is_active:
            raise InventoryNotFoundError("Tipo de producto no encontrado o inactivo.")
        product_code = f"{material_code}{product_type.category_code}{product_type.model_code}"
        return product_code, product_type

    def match_material_code(self, text: str | None) -> str | None:
        """Empata el texto de material de un lote con un segmento MATERIAL del
        catálogo: exacto primero; si no, el segmento cuya etiqueta esté
        contenida en el texto (ej. "ORO 18K" → ORO), la más larga que calce.
        Si no empata con ninguno, CREA el segmento con el siguiente código
        libre: el catálogo crece solo con cada material nuevo, nada quemado."""
        if not text:
            return None
        from sqlalchemy import select
        from backend.modules.catalog.models import CatalogSegment

        segments = self.repository.session.execute(
            select(CatalogSegment).where(
                CatalogSegment.kind == "MATERIAL",
                CatalogSegment.is_active.is_(True),
            )
        ).scalars().all()
        clean = text.strip().upper()
        exact = next((s for s in segments if s.label.strip().upper() == clean), None)
        if exact is not None:
            return exact.code
        partial = sorted(
            (s for s in segments if s.label.strip().upper() in clean),
            key=lambda s: -len(s.label),
        )
        if partial:
            return partial[0].code

        from backend.modules.catalog.schemas import CatalogSegmentCreate
        from backend.modules.catalog.service import CatalogService

        created = CatalogService(self.repository.session).create_segment(
            CatalogSegmentCreate(kind="MATERIAL", label=clean)
        )
        return created.code

    def convert_lot_to_product(
        self,
        lot_item_id: UUID,
        payload: LotConversionCreate,
        user_id: UUID | None,
        assembly_note: str | None = None,
        extra_grams_per_unit: Decimal | None = None,
    ) -> InventoryItemRead:
        """Convierte parcialmente un lote de proceso terminado (SKU = código OP)
        en un producto del catálogo. Consumo y producción quedan como el par de
        movimientos CONVERSION_SALIDA/CONVERSION_ENTRADA; nunca se edita stock
        directo. Mismo producto + mismo material = MISMA fila: la conversión
        suma stock sin importar de qué lote venga (la trazabilidad por lote
        vive en los movimientos). Destino por pieza (target_item_id): si el
        material del lote coincide con el de la pieza elegida, suma ahí; si
        no, crea/reusa otra fila con el mismo modelo y el material del lote.
        Destino por tipo (product_type_id): suma a la fila del producto."""
        lot = self._get_item_or_raise(lot_item_id)
        if lot.item_type != "FINISHED_PRODUCT":
            raise InventoryDomainError("Solo se pueden convertir lotes de procesos terminados.")
        is_production_lot = any(
            movement.reference_type == "production_order"
            for movement in self.repository.list_movements(lot.id)
        )
        if not is_production_lot:
            raise InventoryDomainError("El item no es un lote de una orden de produccion.")
        if lot.current_stock < payload.quantity:
            raise InventoryDomainError("Stock insuficiente en el lote.")

        # Material: siempre el de fabricación del lote (su materia prima; sin
        # material no arranca producción). Si no empata con un segmento del
        # catálogo, se crea uno nuevo con el siguiente código libre.
        lot_material = (payload.material_type or lot.material_type or "").strip()
        material_code = payload.material_code or self.match_material_code(lot_material)
        if not material_code:
            raise InventoryDomainError("El lote no tiene material registrado.")

        # La pieza convertida se mide en la unidad con la que pesa la
        # producción (gramos), con el PESO FINAL de la orden (merma
        # incluida); orden sin pesajes → peso final = peso inicial (gramos
        # de materia prima por unidad).
        from sqlalchemy import select
        from backend.modules.production.models import ProductionRun

        run = self.repository.session.execute(
            select(ProductionRun).where(ProductionRun.production_code == lot.sku)
        ).scalar_one_or_none()
        run_info = self._run_grams_per_unit(run) if run is not None else None
        if run_info is not None:
            weight_per_unit, entry_unit = run_info
            if extra_grams_per_unit:
                # Ensamble: el peso final suma el peso real del lote mas los
                # gramos de los complementos combinados (sin dato -> no se
                # inventa peso, solo se suma lo que aporta la combinacion).
                weight_per_unit = weight_per_unit + extra_grams_per_unit
            entry_quantity = payload.quantity * weight_per_unit
        else:
            # Fallback en unidades (sin peso de la orden): los extra_grams no
            # tienen base para prorratearse, se ignoran.
            weight_per_unit = None
            entry_quantity = payload.quantity
            entry_unit = lot.unit_code

        if payload.target_item_id is not None:
            piece = self._get_item_or_raise(payload.target_item_id)
            if (
                piece.item_type != "FINISHED_PRODUCT"
                or not piece.product_code
                or len(piece.product_code) != 7
            ):
                raise InventoryDomainError(
                    "El destino debe ser un producto terminado del catálogo."
                )
            # Código destino: material del lote + modelo de la pieza.
            product_code = f"{material_code}{piece.product_code[1:]}"
            if product_code == piece.product_code and self._norm_text(
                lot_material
            ) == self._norm_text(piece.material_type):
                # Mismo material (código y texto): suma a la pieza elegida.
                target = piece
            else:
                # La descripción es el modelo real y el nombre distingue tipos
                # que comparten código (ej. TEST y TEST2 ambos x530001): el
                # reúso exige código, nombre, descripción y material iguales
                # — sin importar el lote de origen.
                target = next(
                    (
                        item
                        for item in self.repository.list_items("FINISHED_PRODUCT")
                        if item.product_code == product_code
                        and item.name == piece.name
                        and (item.description or "") == (piece.description or "")
                        and self._norm_text(item.material_type) == self._norm_text(lot_material)
                    ),
                    None,
                )
                if target is None:
                    target = InventoryItem(
                        item_type="FINISHED_PRODUCT",
                        name=piece.name,
                        sku=self._generate_piece_sku(product_code),
                        product_code=product_code,
                        source_lot_sku=lot.sku,
                        description=piece.description,
                        material_type=lot_material or None,
                        unit_code=entry_unit,
                        weight_per_unit=weight_per_unit,
                        minimum_stock=None,
                    )
                    self.repository.add_item(target)
                    self.repository.flush()
        elif payload.product_type_id is not None:
            product_code, product_type = self._resolve_catalog_target(
                material_code, payload.product_type_id
            )
            # El nombre distingue tipos que comparten código (TEST vs TEST2).
            # Sin filtro por lote: el mismo producto acumula stock aunque
            # venga de órdenes distintas (el kardex guarda el lote).
            target = next(
                (
                    item
                    for item in self.repository.list_items("FINISHED_PRODUCT")
                    if item.product_code == product_code
                    and item.name == (product_type.name or lot.name)
                    and not (item.description or "").strip()
                    and self._norm_text(item.material_type) == self._norm_text(lot_material)
                ),
                None,
            )
            if target is None:
                target = InventoryItem(
                    item_type="FINISHED_PRODUCT",
                    name=product_type.name or lot.name,
                    sku=self._generate_piece_sku(product_code),
                    product_code=product_code,
                    source_lot_sku=lot.sku,
                    material_type=payload.material_type or lot.material_type,
                    unit_code=entry_unit,
                    weight_per_unit=weight_per_unit,
                    minimum_stock=None,
                )
                self.repository.add_item(target)
                self.repository.flush()
            elif payload.material_type:
                target.material_type = payload.material_type
        else:
            raise InventoryDomainError("Falta el producto destino de la conversión.")

        # Trazabilidad: la pieza hereda la pureza del lote (que a su vez viene
        # de la materia prima de la orden). Nunca pisa una pureza ya asignada.
        if lot.purity and not target.purity:
            target.purity = lot.purity

        # Una sola operación contada completa en ambos asientos: el kardex de
        # cada lado dice de dónde vino y en qué acabó.
        target_label = (target.description or "").strip() or target.name
        # Ensamble de producción: el kardex cuenta el lote Y los complementos
        # que se combinaron; una conversión simple solo lote → producto.
        story = (
            f"Ensamble: lote {lot.sku} + {assembly_note} -> {target_label} ({product_code})"
            if assembly_note
            else f"Conversion: lote {lot.sku} -> {target_label} ({product_code})"
        )[:240]
        self.create_movement(
            InventoryMovementCreate(
                item_id=lot.id,
                movement_type="CONVERSION_SALIDA",
                quantity=payload.quantity,
                reason=story,
                reference_type="lot_conversion",
                reference_id=target.id,
            ),
            user_id=user_id,
        )
        self.create_movement(
            InventoryMovementCreate(
                item_id=target.id,
                movement_type="CONVERSION_ENTRADA",
                # Entra en la unidad de la producción (gramos por unidad).
                quantity=entry_quantity,
                reason=story,
                reference_type="lot_conversion",
                reference_id=lot.id,
            ),
            user_id=user_id,
            lot_code=lot.sku,
        )
        self.repository.flush()
        return InventoryItemRead.model_validate(target)

    def convert_lot_to_complement(
        self, lot_item_id: UUID, complement_item_id: UUID, quantity: Decimal, user_id: UUID | None
    ) -> InventoryItemRead:
        """Convierte unidades de un lote de producción en stock de un
        complemento fabricado en casa: par CONVERSION_SALIDA/ENTRADA, sin
        catálogo de producto (los complementos no llevan código de modelo)."""
        lot = self._get_item_or_raise(lot_item_id)
        if lot.item_type != "FINISHED_PRODUCT":
            raise InventoryDomainError("Solo se pueden convertir lotes de procesos terminados.")
        is_production_lot = any(
            movement.reference_type == "production_order"
            for movement in self.repository.list_movements(lot.id)
        )
        if not is_production_lot:
            raise InventoryDomainError("El item no es un lote de una orden de produccion.")
        if lot.current_stock < quantity:
            raise InventoryDomainError("Stock insuficiente en el lote.")

        complement = self._get_item_or_raise(complement_item_id)
        if complement.item_type != "COMPLEMENT":
            raise InventoryDomainError("El destino debe ser un complemento del inventario.")

        story = f"Conversion: lote {lot.sku} -> {complement.name} (complemento)"[:240]
        self.create_movement(
            InventoryMovementCreate(
                item_id=lot.id,
                movement_type="CONVERSION_SALIDA",
                quantity=quantity,
                reason=story,
                reference_type="lot_conversion",
                reference_id=complement.id,
            ),
            user_id=user_id,
        )
        self.create_movement(
            InventoryMovementCreate(
                item_id=complement.id,
                movement_type="CONVERSION_ENTRADA",
                quantity=quantity,
                reason=story,
                reference_type="lot_conversion",
                reference_id=lot.id,
            ),
            user_id=user_id,
            lot_code=lot.sku,
        )
        self.repository.flush()
        return InventoryItemRead.model_validate(complement)

    def combine_products(
        self, payload: ProductCombineCreate, user_id: UUID | None
    ) -> InventoryItemRead:
        """Ensambla varias piezas de productos terminados en un producto del
        catálogo (ej. cadena + dije = collar). Cada pieza de origen registra una
        CONVERSION_SALIDA y el producto resultante una CONVERSION_ENTRADA; nada
        de edición directa de stock. Destino por pieza (target_item_id): mismo
        material (código Y texto) → suma a esa pieza; distinto → crea/reusa
        fila con el mismo modelo (descripción) y el material elegido. Destino
        por tipo: fila con la marca de ensamblado."""
        ids = [line.item_id for line in payload.sources]
        if len(ids) != len(set(ids)):
            raise InventoryDomainError("No repitas la misma pieza en el ensamble.")
        sources = []
        gram_infos = []
        for line in payload.sources:
            item = self._get_item_or_raise(line.item_id)
            if item.item_type != "FINISHED_PRODUCT":
                raise InventoryDomainError("Solo se pueden ensamblar productos terminados.")
            info = self._grams_per_unit(item)
            gram_infos.append(info)
            # Descuento: piezas medidas en peso bajan cantidad x gramos/unidad;
            # las medidas en unidades (o sin dato de peso) bajan la cantidad.
            required = (
                line.quantity * info[0]
                if info is not None and item.unit_code == info[1]
                else line.quantity
            )
            if item.current_stock < required:
                raise InventoryDomainError(f"Stock insuficiente de '{item.name}'.")
            sources.append((item, required))

        # REGLA ÚNICA del sistema: el material y la pureza del resultado son
        # los de la pieza que aporta MÁS GRAMOS al ensamble, y punto (el
        # dígito del código ya distingue material; no hay textos combinados).
        # Empate o aportes desconocidos → la primera pieza del ensamble.
        # payload.material_type / payload.purity ganan siempre.
        dominant_item = sources[0][0]
        if all(info is not None for info in gram_infos):
            best = None
            for (item, _), line, info in zip(sources, payload.sources, gram_infos):
                grams = line.quantity * info[0]
                if best is None or grams > best:
                    best = grams
                    dominant_item = item
        auto_material = (dominant_item.material_type or "").strip() or None
        auto_purity = (dominant_item.purity or "").strip() or None

        # El resultado sale en gramos SOLO si todas las piezas tienen gramos
        # por unidad (piezas del sistema o lotes de una orden): el peso del
        # ensamble es la suma de los pesos de sus piezas, contando las que
        # entran repetidas (línea con cantidad = ensambles × N por ensamble).
        # Si alguna pieza vieja no trae el dato, queda en unidades para no
        # descuadrar.
        if all(info is not None for info in gram_infos):
            entry_quantity = sum(
                line.quantity * info[0]
                for line, info in zip(payload.sources, gram_infos)
            )
            weight_per_unit = entry_quantity / payload.quantity
            entry_unit = gram_infos[0][1]
        else:
            weight_per_unit = None
            entry_quantity = payload.quantity
            entry_unit = sources[0][0].unit_code

        if payload.target_item_id is not None:
            piece = self._get_item_or_raise(payload.target_item_id)
            if (
                piece.item_type != "FINISHED_PRODUCT"
                or not piece.product_code
                or len(piece.product_code) != 7
            ):
                raise InventoryDomainError(
                    "El destino debe ser un producto terminado del catálogo."
                )
            product_code = f"{payload.material_code}{piece.product_code[1:]}"
            # El material se compara por texto, no solo por segmento: un
            # ensamble "test + PLATA" comparte código con la pieza PLATA pero
            # no es el mismo material, y sumarlo a la pieza re-etiquetaría
            # stock existente. Sin override del usuario aplica la herencia
            # por gramos dominantes.
            material_type = payload.material_type or auto_material or piece.material_type
            _norm = self._norm_text

            if product_code == piece.product_code and _norm(material_type) == _norm(
                piece.material_type
            ):
                # Mismo material: se suma a la pieza elegida tal cual.
                target = piece
            else:
                # La descripción es el modelo real y el nombre distingue tipos
                # que comparten código: el reúso exige código, nombre,
                # descripción y material iguales.
                target = next(
                    (
                        item
                        for item in self.repository.list_items("FINISHED_PRODUCT")
                        if item.product_code == product_code
                        and item.name == piece.name
                        and (item.description or "") == (piece.description or "")
                        and _norm(item.material_type) == _norm(material_type)
                    ),
                    None,
                )
                if target is None:
                    target = InventoryItem(
                        item_type="FINISHED_PRODUCT",
                        name=piece.name,
                        sku=self._generate_piece_sku(product_code),
                        product_code=product_code,
                        description=piece.description,
                        material_type=material_type,
                        unit_code=entry_unit,
                        weight_per_unit=weight_per_unit,
                        minimum_stock=None,
                    )
                    self.repository.add_item(target)
                    self.repository.flush()
        elif payload.product_type_id is not None:
            product_code, product_type = self._resolve_catalog_target(
                payload.material_code, payload.product_type_id
            )
            ASSEMBLED_MARK = "Producto ensamblado."
            # El nombre distingue tipos que comparten código (TEST vs TEST2).
            target = next(
                (
                    item
                    for item in self.repository.list_items("FINISHED_PRODUCT")
                    if item.product_code == product_code
                    and item.source_lot_sku is None
                    and item.name == (product_type.name or product_code)
                    and (item.description or "") == ASSEMBLED_MARK
                ),
                None,
            )
            if target is None:
                target = InventoryItem(
                    item_type="FINISHED_PRODUCT",
                    name=product_type.name or product_code,
                    sku=self._generate_piece_sku(product_code),
                    product_code=product_code,
                    description=ASSEMBLED_MARK,
                    material_type=payload.material_type or auto_material,
                    unit_code=entry_unit,
                    weight_per_unit=weight_per_unit,
                    minimum_stock=None,
                )
                self.repository.add_item(target)
                self.repository.flush()
            elif payload.material_type:
                target.material_type = payload.material_type
        else:
            raise InventoryDomainError("Falta el producto destino del ensamble.")

        # Pureza heredada por gramos dominantes (o la elegida por el usuario);
        # nunca pisa una pureza ya asignada a una pieza existente.
        purity_final = (payload.purity or "").strip() or auto_purity
        if purity_final and not target.purity:
            target.purity = purity_final

        # Una sola operación contada completa en TODOS los asientos: cada
        # kardex (piezas fuente y producto final) dice qué piezas se sumaron
        # (con su cantidad entre paréntesis), de dónde vinieron y en qué
        # acabaron. Los lotes (sin código de producto) se nombran por su
        # nombre = el proceso que los generó; su descripción es genérica.
        def _qty_text(value):
            text = format(value, "f")
            return text.rstrip("0").rstrip(".") if "." in text else text

        def _piece_label(item):
            if item.product_code and (item.description or "").strip():
                return item.description.strip()
            return item.name

        target_label = _piece_label(target)
        detail = " + ".join(
            f"{_piece_label(item)} ({_qty_text(line.quantity)})"
            for (item, _), line in zip(sources, payload.sources)
        )
        story = f"Ensamble: {detail} -> {target_label} ({product_code})"[:240]
        for item, quantity in sources:
            self.create_movement(
                InventoryMovementCreate(
                    item_id=item.id,
                    movement_type="CONVERSION_SALIDA",
                    quantity=quantity,
                    reason=story,
                    reference_type="product_assembly",
                    reference_id=target.id,
                ),
                user_id=user_id,
            )
        # Trazabilidad de lote: si el ensamble consume exactamente un lote de
        # producción (pieza sin código de producto), la entrada lo arrastra.
        source_lots = [item.sku for item, _ in sources if not item.product_code]
        self.create_movement(
            InventoryMovementCreate(
                item_id=target.id,
                movement_type="CONVERSION_ENTRADA",
                # Entra en la unidad de la producción (gramos por unidad).
                quantity=entry_quantity,
                reason=story,
                reference_type="product_assembly",
                reference_id=sources[0][0].id,
            ),
            user_id=user_id,
            lot_code=source_lots[0] if len(source_lots) == 1 else None,
        )
        self.repository.flush()
        return InventoryItemRead.model_validate(target)

    def commit_finished_production(
        self,
        production_order_id: UUID,
        finished_product_id: UUID,
        finished_quantity: Decimal,
        production_code: str | None = None,
    ) -> None:
        item = self._get_item_or_raise(finished_product_id)
        payload = InventoryMovementCreate(
            item_id=item.id,
            movement_type="INGRESO_PRODUCCION",
            quantity=finished_quantity,
            reason="Ingreso de producto terminado desde produccion.",
            reference_type="production_order",
            reference_id=production_order_id,
        )
        self.create_movement(payload, user_id=None, lot_code=production_code)

    def _grams_per_unit(self, item: InventoryItem) -> tuple[Decimal, str] | None:
        """Gramos por unidad de una pieza y su unidad de peso: el campo propio
        (piezas nacidas con el sistema o cargado desde el histórico de la
        empresa) o, si la pieza es el lote de una orden, el peso real de esa
        orden. None para piezas viejas sin el dato."""
        if item.weight_per_unit and item.weight_per_unit > 0:
            # El peso siempre es en gramos: en items medidos en unidades
            # (lotes) el unit_code no es la unidad del peso.
            return item.weight_per_unit, item.unit_code if item.unit_code == "g" else "g"
        from sqlalchemy import select
        from backend.modules.production.models import ProductionRun

        run = self.repository.session.execute(
            select(ProductionRun).where(ProductionRun.production_code == item.sku)
        ).scalar_one_or_none()
        if run is not None:
            return self._run_grams_per_unit(run)
        return None

    @staticmethod
    def _norm_text(text: str | None) -> str:
        """Normaliza textos de material/pureza para comparar identidad."""
        return (text or "").strip().upper()

    @staticmethod
    def _run_grams_per_unit(run) -> tuple[Decimal, str] | None:
        """PESO FINAL por unidad de producto de una orden de producción:
        el peso real registrado en la última etapa que pesó (merma incluida)
        repartido entre las unidades fabricadas. Caso específico de una orden
        que terminó sin pesar en ninguna etapa: el peso final ES el peso
        inicial, es decir los gramos de materia prima por unidad con los que
        arrancó. Ese planificado nunca pisa un peso real registrado."""
        final_weight = run.actual_finished_weight
        if not final_weight or final_weight <= 0:
            weighed = [
                stage.final_weight
                for stage in sorted(run.stages, key=lambda stage: stage.stage_order)
                if stage.final_weight is not None and stage.final_weight > 0
            ]
            final_weight = weighed[-1] if weighed else None
        if final_weight and final_weight > 0 and run.quantity and run.quantity > 0:
            return final_weight / run.quantity, run.raw_material_unit_code
        if run.total_required_material and run.total_required_material > 0 and run.quantity and run.quantity > 0:
            return run.total_required_material / run.quantity, run.raw_material_unit_code
        return None

    def _generate_piece_sku(self, product_code: str) -> str:
        """SKU de una pieza del catálogo = su código de producto: una fila
        por código (el dígito de material ya distingue). Sufijo -N solo si
        el código ya estuviera tomado (caso anómalo)."""
        if self.repository.get_item_by_sku(product_code) is None:
            return product_code
        number = 2
        while self.repository.get_item_by_sku(f"{product_code}-{number}") is not None:
            number += 1
        return f"{product_code}-{number}"

    def _generate_sku(self, item_type: str) -> str:
        prefix = ITEM_TYPE_PREFIXES.get(item_type, "INV")
        existing = self.repository.list_items(item_type)
        next_number = len(existing) + 1
        while True:
            sku = f"{prefix}-{next_number:04d}"
            if self.repository.get_item_by_sku(sku) is None:
                return sku
            next_number += 1

    def _get_item_or_raise(self, item_id: UUID) -> InventoryItem:
        item = self.repository.get_item(item_id)
        if item is None:
            raise InventoryNotFoundError("Item de inventario no encontrado.")
        return item

    @staticmethod
    def _movement_delta(movement_type: str, quantity: Decimal) -> Decimal:
        if movement_type in POSITIVE_MOVEMENTS:
            return quantity
        if movement_type in NEGATIVE_MOVEMENTS:
            return -quantity
        raise InventoryDomainError("Tipo de movimiento invalido.")
