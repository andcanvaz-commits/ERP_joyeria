from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from backend.modules.auth.dependencies import CurrentUser, get_current_user
from backend.modules.database.session import SessionLocal
from backend.modules.production.repository import ProductionOrderRepository
from backend.modules.production.schemas import (
    ProcessTemplateCreate,
    ProcessTemplateRead,
    ProductionOrderCreate,
    ProductionOrderRead,
    ProductionStageFinish,
    ProductionStageStart,
)
from backend.modules.production.service import ProductionDomainError, ProductionService
from backend.modules.security.permissions import require_permission
from backend.modules.shared.contracts.inventory import (
    InventoryAvailabilityResult,
    ProductionMaterialRequirement,
)


router = APIRouter()


class PendingInventoryIntegration:
    def check_material_availability(
        self,
        requirements: tuple[ProductionMaterialRequirement, ...],
    ) -> InventoryAvailabilityResult:
        raise NotImplementedError("Inventory availability must be provided by inventory module.")

    def reserve_materials_for_production(
        self,
        production_order_id: UUID,
        requirements: tuple[ProductionMaterialRequirement, ...],
    ) -> None:
        raise NotImplementedError("Inventory reservations must be provided by inventory module.")

    def commit_finished_production(
        self,
        production_order_id: UUID,
        finished_product_id: UUID,
        finished_quantity: Decimal,
    ) -> None:
        raise NotImplementedError("Finished production commits must be provided by inventory module.")


def get_production_service():
    session = SessionLocal()
    try:
        yield ProductionService(
            repository=ProductionOrderRepository(session),
            inventory_port=PendingInventoryIntegration(),
        )
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def ensure_permission(current_user: CurrentUser, permission: str) -> None:
    try:
        require_permission(current_user, permission)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc


@router.post(
    "/process-templates",
    response_model=ProcessTemplateRead,
    status_code=status.HTTP_201_CREATED,
)
def create_process_template(
    payload: ProcessTemplateCreate,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> ProcessTemplateRead:
    ensure_permission(current_user, "production.process_templates.create")
    try:
        return service.create_process_template(payload)
    except ProductionDomainError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post("/orders", response_model=ProductionOrderRead, status_code=status.HTTP_201_CREATED)
def create_order(
    payload: ProductionOrderCreate,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> ProductionOrderRead:
    ensure_permission(current_user, "production.create")
    try:
        return service.create_order(payload, current_user)
    except ProductionDomainError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post("/orders/{order_id}/start", response_model=ProductionOrderRead)
def start_order(
    order_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> ProductionOrderRead:
    ensure_permission(current_user, "production.start")
    try:
        return service.start_order(order_id, current_user)
    except ProductionDomainError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post("/orders/{order_id}/finish", response_model=ProductionOrderRead)
def finish_order(
    order_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> ProductionOrderRead:
    ensure_permission(current_user, "production.finish")
    try:
        return service.finish_order(order_id)
    except NotImplementedError as exc:
        raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail=str(exc)) from exc
    except ProductionDomainError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post("/stages/{stage_id}/start", response_model=ProductionOrderRead)
def start_stage(
    stage_id: UUID,
    payload: ProductionStageStart,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> ProductionOrderRead:
    ensure_permission(current_user, "production.stages.start")
    try:
        return service.start_stage(stage_id, payload)
    except ProductionDomainError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post("/stages/{stage_id}/finish", response_model=ProductionOrderRead)
def finish_stage(
    stage_id: UUID,
    payload: ProductionStageFinish,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> ProductionOrderRead:
    ensure_permission(current_user, "production.stages.finish")
    try:
        return service.finish_stage(stage_id, payload)
    except ProductionDomainError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
