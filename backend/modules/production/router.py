from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

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


def raise_domain_http_error(exc: ProductionDomainError) -> None:
    status_code = status.HTTP_404_NOT_FOUND if "not found" in str(exc).lower() else status.HTTP_409_CONFLICT
    raise HTTPException(status_code=status_code, detail=str(exc)) from exc


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
        raise_domain_http_error(exc)


@router.get("/process-templates", response_model=list[ProcessTemplateRead])
def list_process_templates(
    product_id: UUID | None = None,
    is_active: bool | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> list[ProcessTemplateRead]:
    ensure_permission(current_user, "production.process_templates.read")
    return service.list_process_templates(
        product_id=product_id,
        is_active=is_active,
        limit=limit,
        offset=offset,
    )


@router.get("/process-templates/{process_template_id}", response_model=ProcessTemplateRead)
def get_process_template(
    process_template_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> ProcessTemplateRead:
    ensure_permission(current_user, "production.process_templates.read")
    try:
        return service.get_process_template(process_template_id)
    except ProductionDomainError as exc:
        raise_domain_http_error(exc)


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
        raise_domain_http_error(exc)


@router.get("/orders", response_model=list[ProductionOrderRead])
def list_orders(
    order_status: str | None = Query(default=None, alias="status"),
    product_id: UUID | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> list[ProductionOrderRead]:
    ensure_permission(current_user, "production.read")
    try:
        return service.list_orders(
            status=order_status,
            product_id=product_id,
            limit=limit,
            offset=offset,
        )
    except ProductionDomainError as exc:
        raise_domain_http_error(exc)


@router.get("/orders/{order_id}", response_model=ProductionOrderRead)
def get_order(
    order_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> ProductionOrderRead:
    ensure_permission(current_user, "production.read")
    try:
        return service.get_order(order_id)
    except ProductionDomainError as exc:
        raise_domain_http_error(exc)


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
        raise_domain_http_error(exc)


@router.post("/orders/{order_id}/pause", response_model=ProductionOrderRead)
def pause_order(
    order_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> ProductionOrderRead:
    ensure_permission(current_user, "production.pause")
    try:
        return service.pause_order(order_id)
    except ProductionDomainError as exc:
        raise_domain_http_error(exc)


@router.post("/orders/{order_id}/resume", response_model=ProductionOrderRead)
def resume_order(
    order_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> ProductionOrderRead:
    ensure_permission(current_user, "production.resume")
    try:
        return service.resume_order(order_id)
    except ProductionDomainError as exc:
        raise_domain_http_error(exc)


@router.post("/orders/{order_id}/cancel", response_model=ProductionOrderRead)
def cancel_order(
    order_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> ProductionOrderRead:
    ensure_permission(current_user, "production.cancel")
    try:
        return service.cancel_order(order_id)
    except ProductionDomainError as exc:
        raise_domain_http_error(exc)


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
        raise_domain_http_error(exc)


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
        raise_domain_http_error(exc)


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
        raise_domain_http_error(exc)
