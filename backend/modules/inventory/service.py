from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID

from backend.modules.config.settings import settings
from backend.modules.inventory.models import InventoryItem, InventoryMovement
from backend.modules.inventory.repository import InventoryRepository
from backend.modules.inventory.schemas import (
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


POSITIVE_MOVEMENTS = {"ENTRADA", "AJUSTE_POSITIVO", "INGRESO_PRODUCCION", "CONVERSION_ENTRADA"}
NEGATIVE_MOVEMENTS = {"SALIDA", "AJUSTE_NEGATIVO", "CONSUMO_PRODUCCION", "MERMA", "CONVERSION_SALIDA"}
ITEM_TYPE_PREFIXES = {
    "RAW_MATERIAL": "MP",
    "SUPPLY": "IN",
    "WORK_IN_PROGRESS": "PP",
    "FINISHED_PRODUCT": "PT",
}

# Tipos que el usuario gestiona directamente (crear/editar/eliminar);
# los demás los administra el flujo de producción.
MANUALLY_MANAGED_TYPES = ("RAW_MATERIAL", "SUPPLY", "FINISHED_PRODUCT")


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
        # Sin stock: se permite eliminar. Se borran tambien sus movimientos para
        # no dejar historial huerfano (integridad referencial).
        for movement in self.repository.list_movements(item_id):
            self.repository.delete_movement(movement)
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

    def list_items(self, item_type: str | None = None) -> list[InventoryItemRead]:
        return [InventoryItemRead.model_validate(item) for item in self.repository.list_items(item_type)]

    def create_movement(
        self, payload: InventoryMovementCreate, user_id: UUID | None, lot_code: str | None = None
    ) -> InventoryMovementRead:
        item = self._get_item_or_raise(payload.item_id)

        delta = self._movement_delta(payload.movement_type, payload.quantity)
        next_stock = item.current_stock + delta
        if next_stock < 0:
            raise InventoryDomainError("El movimiento dejaria el stock en negativo.")

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
        low_stock_items = sum(
            1
            for item in items
            if item.minimum_stock is not None and item.current_stock <= item.minimum_stock
        )
        return InventorySummary(
            raw_materials=sum(1 for item in items if item.item_type == "RAW_MATERIAL"),
            supplies=sum(1 for item in items if item.item_type == "SUPPLY"),
            work_in_progress=sum(1 for item in items if item.item_type == "WORK_IN_PROGRESS"),
            finished_products=sum(1 for item in items if item.item_type == "FINISHED_PRODUCT"),
            low_stock_items=low_stock_items,
            total_items=len(items),
        )

    def check_material_availability(
        self,
        requirements: tuple[ProductionMaterialRequirement, ...],
    ) -> InventoryAvailabilityResult:
        lines = []
        for requirement in requirements:
            item = self.repository.get_item(requirement.item_id)
            available = item.current_stock if item is not None else Decimal("0")
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
        received_by_user_id: UUID | None = None,
    ) -> InventoryItem:
        """Crea un producto terminado POR ORDEN (lote), identificado por el código OP,
        con el código de producto (codificación). Cada orden es su propio lote."""
        sku = (production_code or "").strip() or self._generate_sku("FINISHED_PRODUCT")
        if self.repository.get_item_by_sku(sku) is not None:
            sku = self._generate_sku("FINISHED_PRODUCT")
        item = InventoryItem(
            item_type="FINISHED_PRODUCT",
            name=name,
            sku=sku,
            product_code=product_code,
            description="Producto terminado de produccion.",
            unit_code=unit_code.strip(),
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

    def convert_lot_to_product(
        self, lot_item_id: UUID, payload: LotConversionCreate, user_id: UUID | None
    ) -> InventoryItemRead:
        """Convierte parcialmente un lote de proceso terminado (SKU = código OP)
        en un producto del catálogo. Consumo y producción quedan como el par de
        movimientos CONVERSION_SALIDA/CONVERSION_ENTRADA; nunca se edita stock
        directo. Repetir la conversión mismo tipo + mismo lote suma al mismo
        item; lotes distintos nunca se consolidan."""
        from sqlalchemy import select

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

        session = self.repository.session
        product_code, product_type = self._resolve_catalog_target(
            payload.material_code, payload.product_type_id
        )

        # Filtro por proceso: si el proceso de la orden de este lote declara qué
        # tipos puede producir, la conversión solo acepta esos tipos.
        from backend.modules.production.models import (
            ProductionProcessProductType,
            ProductionRun,
        )

        run = session.execute(
            select(ProductionRun).where(ProductionRun.production_code == lot.sku)
        ).scalar_one_or_none()
        if run is not None:
            allowed = set(
                session.execute(
                    select(ProductionProcessProductType.product_type_id).where(
                        ProductionProcessProductType.process_id == run.process_id
                    )
                ).scalars()
            )
            if allowed and payload.product_type_id not in allowed:
                raise InventoryDomainError(
                    "El proceso de esta orden no produce ese tipo de producto."
                )
        target = next(
            (
                item
                for item in self.repository.list_items("FINISHED_PRODUCT")
                if item.product_code == product_code and item.source_lot_sku == lot.sku
            ),
            None,
        )
        if target is None:
            target = InventoryItem(
                item_type="FINISHED_PRODUCT",
                name=product_type.name or lot.name,
                sku=self._generate_sku("FINISHED_PRODUCT"),
                product_code=product_code,
                source_lot_sku=lot.sku,
                unit_code=lot.unit_code,
                minimum_stock=None,
            )
            self.repository.add_item(target)
            self.repository.flush()

        self.create_movement(
            InventoryMovementCreate(
                item_id=lot.id,
                movement_type="CONVERSION_SALIDA",
                quantity=payload.quantity,
                reason=f"Conversion a producto {product_code}",
                reference_type="lot_conversion",
                reference_id=target.id,
            ),
            user_id=user_id,
        )
        self.create_movement(
            InventoryMovementCreate(
                item_id=target.id,
                movement_type="CONVERSION_ENTRADA",
                quantity=payload.quantity,
                reason=f"Conversion desde lote {lot.sku}",
                reference_type="lot_conversion",
                reference_id=lot.id,
            ),
            user_id=user_id,
            lot_code=lot.sku,
        )
        self.repository.flush()
        return InventoryItemRead.model_validate(target)

    def combine_products(
        self, payload: ProductCombineCreate, user_id: UUID | None
    ) -> InventoryItemRead:
        """Ensambla varias piezas de productos terminados en un producto nuevo del
        catálogo (ej. cadena + dije = collar). Cada pieza de origen registra una
        CONVERSION_SALIDA y el producto resultante una CONVERSION_ENTRADA; nada
        de edición directa de stock. El item resultante se identifica por su
        código de producto con la marca de ensamblado."""
        ids = [line.item_id for line in payload.sources]
        if len(ids) != len(set(ids)):
            raise InventoryDomainError("No repitas la misma pieza en el ensamble.")
        sources = []
        for line in payload.sources:
            item = self._get_item_or_raise(line.item_id)
            if item.item_type != "FINISHED_PRODUCT":
                raise InventoryDomainError("Solo se pueden ensamblar productos terminados.")
            if item.current_stock < line.quantity:
                raise InventoryDomainError(f"Stock insuficiente de '{item.name}'.")
            sources.append((item, line.quantity))

        product_code, product_type = self._resolve_catalog_target(
            payload.material_code, payload.product_type_id
        )

        ASSEMBLED_MARK = "Producto ensamblado."
        target = next(
            (
                item
                for item in self.repository.list_items("FINISHED_PRODUCT")
                if item.product_code == product_code
                and item.source_lot_sku is None
                and (item.description or "") == ASSEMBLED_MARK
            ),
            None,
        )
        if target is None:
            target = InventoryItem(
                item_type="FINISHED_PRODUCT",
                name=product_type.name or product_code,
                sku=self._generate_sku("FINISHED_PRODUCT"),
                product_code=product_code,
                description=ASSEMBLED_MARK,
                unit_code=sources[0][0].unit_code,
                minimum_stock=None,
            )
            self.repository.add_item(target)
            self.repository.flush()

        for item, quantity in sources:
            self.create_movement(
                InventoryMovementCreate(
                    item_id=item.id,
                    movement_type="CONVERSION_SALIDA",
                    quantity=quantity,
                    reason=f"Ensamble en producto {product_code}",
                    reference_type="product_assembly",
                    reference_id=target.id,
                ),
                user_id=user_id,
            )
        detail = " + ".join(f"{item.name}" for item, _ in sources)
        self.create_movement(
            InventoryMovementCreate(
                item_id=target.id,
                movement_type="CONVERSION_ENTRADA",
                quantity=payload.quantity,
                reason=f"Ensamble de: {detail}"[:240],
                reference_type="product_assembly",
                reference_id=sources[0][0].id,
            ),
            user_id=user_id,
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
