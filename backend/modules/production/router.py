from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from backend.modules.auth.dependencies import CurrentUser, get_current_user
from backend.modules.database.session import SessionLocal
from backend.modules.inventory.repository import InventoryRepository
from backend.modules.inventory.service import InventoryService
from backend.modules.production.repository import ProductionProcessRepository
from backend.modules.production.schemas import (
    ProductionProcessCreate,
    ProductionProcessRead,
    ProductionProcessUpdate,
    ProductionRunCreate,
    ProductionRunRead,
    ProductionRunStageFinish,
)
from backend.modules.production.service import ProductionDomainError, ProductionNotFoundError, ProductionService
from backend.modules.security.permissions import require_permission


router = APIRouter()


def get_production_service():
    session = SessionLocal()
    try:
        yield ProductionService(
            repository=ProductionProcessRepository(session),
            inventory_service=InventoryService(repository=InventoryRepository(session)),
        )
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def ensure_permission(current_user: CurrentUser, permission: str) -> None:
    inventory_run_permissions = {"production.runs.read", "production.runs.update"}
    if current_user.role == "Jefe de inventario" and permission in inventory_run_permissions:
        return
    if current_user.role in {"admin", "Admin", "Jefe de producción"} and permission.startswith("production."):
        return
    if current_user.role in {"admin", "Admin", "Jefe de produccion", "Jefe de producción"} and permission.startswith("production."):
        return
    try:
        require_permission(current_user, permission)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc


@router.post("/processes", response_model=ProductionProcessRead, status_code=status.HTTP_201_CREATED)
def create_process(
    payload: ProductionProcessCreate,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> ProductionProcessRead:
    ensure_permission(current_user, "production.processes.create")
    try:
        return service.create_process(payload)
    except ProductionDomainError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.get("/processes", response_model=list[ProductionProcessRead])
def list_processes(
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> list[ProductionProcessRead]:
    ensure_permission(current_user, "production.processes.read")
    return service.list_processes()


@router.put("/processes/{process_id}", response_model=ProductionProcessRead)
def update_process(
    process_id: UUID,
    payload: ProductionProcessUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> ProductionProcessRead:
    ensure_permission(current_user, "production.processes.update")
    try:
        return service.update_process(process_id, payload)
    except ProductionNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ProductionDomainError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post("/runs", response_model=ProductionRunRead, status_code=status.HTTP_201_CREATED)
def create_run(
    payload: ProductionRunCreate,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> ProductionRunRead:
    ensure_permission(current_user, "production.runs.create")
    try:
        return service.create_run(payload, current_user)
    except ProductionNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ProductionDomainError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.get("/runs", response_model=list[ProductionRunRead])
def list_runs(
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> list[ProductionRunRead]:
    ensure_permission(current_user, "production.runs.read")
    return service.list_runs()


@router.post("/runs/{run_id}/approve-materials", response_model=ProductionRunRead)
def approve_run_materials(
    run_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> ProductionRunRead:
    ensure_permission(current_user, "production.runs.update")
    try:
        return service.approve_materials(run_id, current_user)
    except ProductionNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ProductionDomainError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post("/runs/{run_id}/start", response_model=ProductionRunRead)
def start_run(
    run_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> ProductionRunRead:
    ensure_permission(current_user, "production.runs.update")
    try:
        return service.start_run(run_id)
    except ProductionNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ProductionDomainError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post("/runs/stages/{stage_id}/finish", response_model=ProductionRunRead)
def finish_run_stage(
    stage_id: UUID,
    payload: ProductionRunStageFinish,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> ProductionRunRead:
    ensure_permission(current_user, "production.runs.update")
    try:
        return service.finish_stage(stage_id, payload)
    except ProductionNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ProductionDomainError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post("/runs/{run_id}/receive-finished", response_model=ProductionRunRead)
def receive_finished_product(
    run_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> ProductionRunRead:
    ensure_permission(current_user, "production.runs.update")
    try:
        return service.receive_finished_product(run_id)
    except ProductionNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ProductionDomainError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.delete("/processes/{process_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_process(
    process_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> None:
    ensure_permission(current_user, "production.processes.delete")
    try:
        service.delete_process(process_id)
    except ProductionNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
