from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from backend.modules.auth.dependencies import CurrentUser, get_current_user
from backend.modules.database.session import SessionLocal
from backend.modules.production.repository import ProductionProcessRepository
from backend.modules.production.schemas import ProductionProcessCreate, ProductionProcessRead, ProductionProcessUpdate
from backend.modules.production.service import ProductionDomainError, ProductionNotFoundError, ProductionService
from backend.modules.security.permissions import require_permission


router = APIRouter()


def get_production_service():
    session = SessionLocal()
    try:
        yield ProductionService(repository=ProductionProcessRepository(session))
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def ensure_permission(current_user: CurrentUser, permission: str) -> None:
    if current_user.role in {"admin", "Admin"} and permission.startswith("production.processes."):
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
