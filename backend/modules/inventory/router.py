from uuid import UUID
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from backend.modules.auth.dependencies import CurrentUser, get_current_user
from backend.modules.database.session import SessionLocal
from backend.modules.inventory.repository import InventoryRepository
from backend.modules.inventory.schemas import (
    InventoryItemCreate,
    InventoryItemRead,
    InventoryItemType,
    InventoryItemUpdate,
    InventoryMovementCreate,
    InventoryMovementRead,
    InventorySummary,
)
from backend.modules.inventory.service import InventoryDomainError, InventoryNotFoundError, InventoryService
from backend.modules.security.permissions import require_permission


router = APIRouter()


def get_inventory_service():
    session = SessionLocal()
    try:
        yield InventoryService(repository=InventoryRepository(session))
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


# Editar y eliminar inventario es exclusivo del administrador (el jefe de
# inventario puede leer, crear items y registrar movimientos, pero no editar/borrar).
INVENTORY_ADMIN_ONLY = {"inventory.items.update", "inventory.items.delete"}


def ensure_permission(current_user: CurrentUser, permission: str) -> None:
    is_admin = current_user.role in {"admin", "Admin"}
    if permission in INVENTORY_ADMIN_ONLY:
        if is_admin:
            return
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo el administrador puede editar o eliminar el inventario.",
        )
    if current_user.role in {"admin", "Admin", "Jefe de inventario"} and permission.startswith("inventory."):
        return
    try:
        require_permission(current_user, permission)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc


@router.get("/summary", response_model=InventorySummary)
def get_summary(
    current_user: CurrentUser = Depends(get_current_user),
    service: InventoryService = Depends(get_inventory_service),
) -> InventorySummary:
    ensure_permission(current_user, "inventory.read")
    return service.get_summary()


@router.get("/items", response_model=list[InventoryItemRead])
def list_items(
    item_type: InventoryItemType | None = Query(default=None),
    current_user: CurrentUser = Depends(get_current_user),
    service: InventoryService = Depends(get_inventory_service),
) -> list[InventoryItemRead]:
    ensure_permission(current_user, "inventory.read")
    return service.list_items(item_type)


@router.post("/items", response_model=InventoryItemRead, status_code=status.HTTP_201_CREATED)
def create_item(
    payload: InventoryItemCreate,
    current_user: CurrentUser = Depends(get_current_user),
    service: InventoryService = Depends(get_inventory_service),
) -> InventoryItemRead:
    ensure_permission(current_user, "inventory.items.create")
    try:
        return service.create_item(payload)
    except InventoryDomainError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.put("/items/{item_id}", response_model=InventoryItemRead)
def update_item(
    item_id: UUID,
    payload: InventoryItemUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    service: InventoryService = Depends(get_inventory_service),
) -> InventoryItemRead:
    ensure_permission(current_user, "inventory.items.update")
    try:
        return service.update_item(item_id, payload)
    except InventoryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except InventoryDomainError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.get("/movements", response_model=list[InventoryMovementRead])
def list_movements(
    item_id: UUID | None = Query(default=None),
    current_user: CurrentUser = Depends(get_current_user),
    service: InventoryService = Depends(get_inventory_service),
) -> list[InventoryMovementRead]:
    ensure_permission(current_user, "inventory.read")
    return service.list_movements(item_id)


@router.post("/movements", response_model=InventoryMovementRead, status_code=status.HTTP_201_CREATED)
def create_movement(
    payload: InventoryMovementCreate,
    current_user: CurrentUser = Depends(get_current_user),
    service: InventoryService = Depends(get_inventory_service),
) -> InventoryMovementRead:
    ensure_permission(current_user, "inventory.movements.create")
    # Allow both ENTRY and EXIT movements for raw materials inventory
    if payload.movement_type not in {"ENTRADA", "SALIDA"}:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Solo se permiten ingresos y salidas manuales de inventario de materia prima.",
        )
    try:
        return service.create_movement(payload, user_id=current_user.id)
    except InventoryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except InventoryDomainError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.get("/movements/{movement_id}/source-file")
def download_movement_source_file(
    movement_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    service: InventoryService = Depends(get_inventory_service),
) -> Response:
    ensure_permission(current_user, "inventory.read")
    try:
        file_name, mime_type, content = service.get_movement_source_file(movement_id)
    except InventoryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return Response(
        content=content,
        media_type=mime_type,
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(file_name)}"},
    )
