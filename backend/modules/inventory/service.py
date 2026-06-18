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
        item.unit_code = payload.unit_code.strip()
        item.minimum_stock = payload.minimum_stock
        self.repository.flush()
        return InventoryItemRead.model_validate(item)

    def list_items(self, item_type: str | None = None) -> list[InventoryItemRead]:
        return [InventoryItemRead.model_validate(item) for item in self.repository.list_items(item_type)]

    def create_movement(self, payload: InventoryMovementCreate, user_id: UUID | None) -> InventoryMovementRead:
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
        item.current_stock = next_stock
        self.repository.add_movement(movement)
        self.repository.flush()
        return InventoryMovementRead.model_validate(movement)

    def list_movements(self, item_id: UUID | None = None) -> list[InventoryMovementRead]:
        return [InventoryMovementRead.model_validate(movement) for movement in self.repository.list_movements(item_id)]

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

    def commit_finished_production(
        self,
        production_order_id: UUID,
        finished_product_id: UUID,
        finished_quantity: Decimal,
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
        self.create_movement(payload, user_id=None)

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
