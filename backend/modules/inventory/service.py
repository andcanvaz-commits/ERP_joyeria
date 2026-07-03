from datetime import datetime
from decimal import Decimal
from uuid import UUID

from backend.modules.inventory.models import InventoryItem, InventoryMovement
from backend.modules.inventory.repository import InventoryRepository
from backend.modules.inventory.schemas import (
    InventoryItemCreate,
    InventoryItemRead,
    InventoryItemUpdate,
    InventoryMovementCreate,
    InventoryMovementRead,
    InventorySummary,
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


def _generate_lot_code(repository: "InventoryRepository", item_name: str, item_id, year: int) -> str:
    prefix = "".join(c for c in item_name.upper() if c.isalpha())[:2] or "XX"
    year_short = str(year)[-2:]
    seq = repository.count_entrada_movements_for_item_this_year(item_id, year) + 1
    return f"LOT-{prefix}-{year_short}{seq:04d}"


class InventoryDomainError(ValueError):
    pass


class InventoryNotFoundError(LookupError):
    pass


POSITIVE_MOVEMENTS = {"ENTRADA", "AJUSTE_POSITIVO", "INGRESO_PRODUCCION"}
NEGATIVE_MOVEMENTS = {"SALIDA", "AJUSTE_NEGATIVO", "CONSUMO_PRODUCCION", "MERMA"}
ITEM_TYPE_PREFIXES = {
    "RAW_MATERIAL": "MP",
    "WORK_IN_PROGRESS": "PP",
    "FINISHED_PRODUCT": "PT",
}


class InventoryService(InventoryIntegrationPort):
    def __init__(self, repository: InventoryRepository) -> None:
        self.repository = repository

    def create_item(self, payload: InventoryItemCreate) -> InventoryItemRead:
        if payload.item_type != "RAW_MATERIAL":
            raise InventoryDomainError("Solo se pueden crear manualmente materias primas.")
        item = InventoryItem(
            item_type=payload.item_type,
            name=payload.name,
            sku=self._generate_sku(payload.item_type),
            description=payload.description,
            material_type=payload.material_type,
            purity=payload.purity,
            unit_code=payload.unit_code.strip(),
            minimum_stock=payload.minimum_stock,
        )
        self.repository.add_item(item)
        self.repository.flush()
        return InventoryItemRead.model_validate(item)

    def update_item(self, item_id: UUID, payload: InventoryItemUpdate) -> InventoryItemRead:
        item = self._get_item_or_raise(item_id)
        if item.item_type != "RAW_MATERIAL" or payload.item_type != "RAW_MATERIAL":
            raise InventoryDomainError("Solo se pueden editar manualmente materias primas.")

        item.item_type = payload.item_type
        item.name = payload.name
        item.description = payload.description
        item.material_type = payload.material_type
        item.purity = payload.purity
        item.unit_code = payload.unit_code.strip()
        item.minimum_stock = payload.minimum_stock
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
                item.name,
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
    ) -> InventoryMovementRead:
        payload = InventoryMovementCreate(
            item_id=item_id,
            movement_type="CONSUMO_PRODUCCION",
            quantity=quantity,
            reason="Consumo de materia prima por inicio de produccion.",
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
