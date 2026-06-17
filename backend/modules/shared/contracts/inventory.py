from dataclasses import dataclass
from decimal import Decimal
from typing import Protocol
from uuid import UUID


@dataclass(frozen=True)
class ProductionMaterialRequirement:
    item_id: UUID
    quantity: Decimal
    unit_code: str


@dataclass(frozen=True)
class InventoryAvailabilityLine:
    item_id: UUID
    required_quantity: Decimal
    available_quantity: Decimal
    missing_quantity: Decimal


@dataclass(frozen=True)
class InventoryAvailabilityResult:
    has_enough_stock: bool
    lines: tuple[InventoryAvailabilityLine, ...]


class InventoryIntegrationPort(Protocol):
    def check_material_availability(
        self,
        requirements: tuple[ProductionMaterialRequirement, ...],
    ) -> InventoryAvailabilityResult:
        """Return stock availability for production without mutating inventory."""

    def reserve_materials_for_production(
        self,
        production_order_id: UUID,
        requirements: tuple[ProductionMaterialRequirement, ...],
    ) -> None:
        """Reserve required materials when inventory implements reservations."""

    def commit_finished_production(
        self,
        production_order_id: UUID,
        finished_product_id: UUID,
        finished_quantity: Decimal,
    ) -> None:
        """Notify inventory that production finished; inventory owns stock movements."""
