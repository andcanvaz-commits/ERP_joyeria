from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from backend.modules.auth.dependencies import CurrentUser, get_current_user
from backend.modules.database.session import SessionLocal
from backend.modules.inventory.repository import InventoryRepository
from backend.modules.inventory.service import InventoryService
from backend.modules.production.repository import ProductionProcessRepository
from backend.modules.production.schemas import (
    ActaLineCreate,
    ActaLineUpdate,
    AdminActaLineCreate,
    ProductionOrderCreate,
    ProductionProcessCreate,
    ProductionProcessRead,
    ProductionProcessUpdate,
    ProductionRunRead,
    RunCancelPayload,
    RunProductsUpdate,
    StageAttemptCreate,
    StageAttemptFinish,
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


ADMIN_ONLY_PRODUCTION_PERMISSIONS = {
    # Cancelar una orden y borrar una plantilla de proceso son exclusivos del
    # administrador, sin importar el permiso que tenga el rol fusionado
    # Produccion/Inventario.
    "production.runs.delete": "Solo el administrador puede cancelar una orden de produccion.",
    "production.processes.delete": "Solo el administrador puede eliminar un proceso.",
    "production.acta-lines.admin-stock": "Solo el administrador puede agregar una linea de acta enlazada a inventario o de texto libre desde este boton.",
}


def ensure_permission(current_user: CurrentUser, permission: str) -> None:
    is_admin = current_user.role in {"admin", "Admin"}
    if permission in ADMIN_ONLY_PRODUCTION_PERMISSIONS:
        if is_admin:
            return
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=ADMIN_ONLY_PRODUCTION_PERMISSIONS[permission],
        )
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


@router.post("/orders", response_model=ProductionRunRead, status_code=status.HTTP_201_CREATED)
def create_order(
    payload: ProductionOrderCreate,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> ProductionRunRead:
    """Flujo nuevo (docs/cambios-sistema-produccion.md seccion 4.1): crea la
    orden con solo un nombre libre, sin proceso ni materia prima fijos."""
    ensure_permission(current_user, "production.runs.create")
    return service.create_order(payload, current_user)


@router.post("/runs/{run_id}/stage-attempts", response_model=ProductionRunRead, status_code=status.HTTP_201_CREATED)
def start_stage_attempt(
    run_id: UUID,
    payload: StageAttemptCreate,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> ProductionRunRead:
    """Seccion 4.2: elige un proceso del banco y arranca un intento de etapa."""
    ensure_permission(current_user, "production.runs.update")
    try:
        return service.start_stage_attempt(run_id, payload, current_user)
    except ProductionNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ProductionDomainError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post("/runs/stage-attempts/{attempt_id}/finish", response_model=ProductionRunRead)
def finish_stage_attempt(
    attempt_id: UUID,
    payload: StageAttemptFinish,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> ProductionRunRead:
    """Seccion 4: ✔ (APROBADA, calcula merma propia del intento) o ✘
    (RECHAZADA, motivo opcional, no repite el proceso automaticamente)."""
    ensure_permission(current_user, "production.runs.update")
    try:
        return service.finish_stage_attempt(attempt_id, payload, current_user)
    except ProductionNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ProductionDomainError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post("/runs/stage-attempts/{attempt_id}/allocate-material", response_model=ProductionRunRead)
def allocate_stage_attempt_material(
    attempt_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> ProductionRunRead:
    """Asigna stock recien disponible a un intento PENDIENTE_MATERIAL --
    consume lo que alcance y, si queda 100% cubierto y no hay otro intento
    EN_PROCESO en la orden, lo arranca."""
    ensure_permission(current_user, "production.runs.update")
    try:
        return service.allocate_stage_attempt_material(attempt_id, current_user)
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


@router.put("/runs/{run_id}/products", response_model=ProductionRunRead)
def update_run_products(
    run_id: UUID,
    payload: RunProductsUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> ProductionRunRead:
    ensure_permission(current_user, "production.runs.update")
    try:
        return service.update_run_products(run_id, payload, current_user)
    except ProductionNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ProductionDomainError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post("/runs/{run_id}/cancel", response_model=ProductionRunRead)
def cancel_run(
    run_id: UUID,
    payload: RunCancelPayload,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> ProductionRunRead:
    # Cancelar una orden ya avanzada (etapa aceptada por error, dato mal
    # tipeado): revierte inventario. Distinto de reject-materials, que solo
    # sirve antes de tocar inventario.
    ensure_permission(current_user, "production.runs.delete")
    try:
        return service.cancel_run(run_id, current_user, payload.reason)
    except ProductionNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ProductionDomainError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post("/runs/{run_id}/finish", response_model=ProductionRunRead)
def finish_order(
    run_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> ProductionRunRead:
    ensure_permission(current_user, "production.runs.update")
    try:
        return service.finish_order(run_id, current_user)
    except ProductionNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ProductionDomainError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post("/runs/{run_id}/cancel-family", response_model=list[ProductionRunRead])
def cancel_run_family(
    run_id: UUID,
    payload: RunCancelPayload,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> list[ProductionRunRead]:
    # Cancela toda la familia (raiz + corridas hijas de split) de una vez,
    # sin el chequeo de "hijo activo" de cancel_run -- pensado para cuando
    # un split arranco solo una parte y el resto ya no tiene sentido esperar.
    ensure_permission(current_user, "production.runs.delete")
    try:
        return service.cancel_run_family(run_id, current_user, payload.reason)
    except ProductionNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ProductionDomainError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc




@router.post("/runs/{run_id}/acta-lines", response_model=ProductionRunRead)
def add_acta_line(
    run_id: UUID,
    payload: ActaLineCreate,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> ProductionRunRead:
    ensure_permission(current_user, "production.runs.update")
    try:
        return service.add_acta_line(run_id, payload, current_user)
    except ProductionNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ProductionDomainError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post("/runs/{run_id}/acta-lines/admin", response_model=ProductionRunRead)
def add_admin_acta_line(
    run_id: UUID,
    payload: AdminActaLineCreate,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> ProductionRunRead:
    # Ligada a un intento de etapa (flujo nuevo, seccion 2.3): cualquiera del
    # rol fusionado opera el acta directo, ya no es admin-only -- ese gate
    # sigue aplicando solo al boton "+" viejo (linea de nivel de orden).
    if payload.stage_attempt_id is not None:
        ensure_permission(current_user, "production.runs.update")
    else:
        ensure_permission(current_user, "production.acta-lines.admin-stock")
    try:
        return service.add_admin_acta_line(run_id, payload, current_user)
    except ProductionNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ProductionDomainError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.put("/runs/acta-lines/{line_id}", response_model=ProductionRunRead)
def update_acta_line(
    line_id: UUID,
    payload: ActaLineUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> ProductionRunRead:
    ensure_permission(current_user, "production.runs.update")
    try:
        return service.update_acta_line(line_id, payload, current_user)
    except ProductionNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ProductionDomainError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.delete("/runs/acta-lines/{line_id}", response_model=ProductionRunRead)
def delete_acta_line(
    line_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> ProductionRunRead:
    ensure_permission(current_user, "production.runs.update")
    try:
        return service.delete_acta_line(line_id, current_user)
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
