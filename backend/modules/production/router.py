from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from backend.modules.auth.dependencies import CurrentUser, get_current_user
from backend.modules.database.session import SessionLocal
from backend.modules.inventory.repository import InventoryRepository
from backend.modules.inventory.service import InventoryService
from backend.modules.production.repository import ProductionProcessRepository
from backend.modules.production.schemas import (
    AllocateMaterialPayload,
    AssemblyRecipeRead,
    AssemblyRecipeUpsert,
    ProductionProcessCreate,
    ProductionProcessRead,
    ProductionProcessUpdate,
    ProductionRunCreate,
    ProductionRunRead,
    MaterialRejectPayload,
    ProductionRunStageFinish,
    RunAssemblyDefine,
    RunProductsUpdate,
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


@router.put("/runs/{run_id}/products", response_model=ProductionRunRead)
def update_run_products(
    run_id: UUID,
    payload: RunProductsUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> ProductionRunRead:
    # Solo produccion/admin: el plan es del jefe de produccion, no de inventario.
    if current_user.role == "Jefe de inventario":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo produccion puede editar el plan.")
    ensure_permission(current_user, "production.runs.update")
    try:
        return service.update_run_products(run_id, payload, current_user)
    except ProductionNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ProductionDomainError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post("/runs/{run_id}/assembly", response_model=ProductionRunRead)
def define_run_assembly(
    run_id: UUID,
    payload: RunAssemblyDefine,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> ProductionRunRead:
    # Solo produccion/admin: el ensamble es del jefe de produccion, no de inventario.
    if current_user.role == "Jefe de inventario":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo produccion puede editar el plan.")
    ensure_permission(current_user, "production.runs.update")
    try:
        return service.define_run_assembly(run_id, payload, current_user)
    except ProductionNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ProductionDomainError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


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


@router.post("/runs/{run_id}/reject-materials", response_model=ProductionRunRead)
def reject_run_materials(
    run_id: UUID,
    payload: MaterialRejectPayload | None = None,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> ProductionRunRead:
    ensure_permission(current_user, "production.runs.update")
    try:
        return service.reject_materials(run_id, current_user, payload.reason if payload else None)
    except ProductionNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ProductionDomainError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post("/runs/{run_id}/allocate-material", response_model=ProductionRunRead)
def allocate_run_material(
    run_id: UUID,
    payload: AllocateMaterialPayload,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> ProductionRunRead:
    # Igual que approve-materials: inventario puede destinar material a una
    # orden que quedo esperando por falta de stock.
    ensure_permission(current_user, "production.runs.update")
    try:
        return service.allocate_material(run_id, payload.quantity_units, current_user)
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
        return service.start_run(run_id, current_user)
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
        return service.finish_stage(stage_id, payload, current_user)
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
        return service.receive_finished_product(run_id, current_user)
    except ProductionNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ProductionDomainError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.get("/assembly-recipes/types", response_model=list[str])
def list_assembly_recipe_model_keys(
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> list[str]:
    ensure_permission(current_user, "production.runs.read")
    return service.list_assembly_recipe_model_keys()


@router.get("/assembly-recipes/all", response_model=list[AssemblyRecipeRead])
def list_assembly_recipes(
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> list[AssemblyRecipeRead]:
    ensure_permission(current_user, "production.runs.read")
    return service.list_assembly_recipes()


@router.get("/assembly-recipes", response_model=AssemblyRecipeRead)
def get_assembly_recipe(
    product_type_id: UUID | None = None,
    item_id: UUID | None = None,
    material_item_id: UUID | None = None,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> AssemblyRecipeRead:
    ensure_permission(current_user, "production.runs.read")
    try:
        return service.get_assembly_recipe(product_type_id, item_id, material_item_id)
    except ProductionDomainError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.put("/assembly-recipes/{model_key}", response_model=AssemblyRecipeRead)
def upsert_assembly_recipe(
    model_key: str,
    payload: AssemblyRecipeUpsert,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> AssemblyRecipeRead:
    # Solo produccion/admin: la receta es del jefe de produccion, no de inventario.
    if current_user.role == "Jefe de inventario":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo produccion puede editar el plan.")
    ensure_permission(current_user, "production.runs.update")
    try:
        return service.upsert_assembly_recipe(model_key, payload, current_user)
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
