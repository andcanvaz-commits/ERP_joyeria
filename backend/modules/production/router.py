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
    AdditionalMaterialRequestCreate,
    AllocateMaterialPayload,
    AllocationPreviewRead,
    AssemblyRecipeRead,
    AssemblyRecipeUpsert,
    ComplementReturnCreate,
    MaterialShortageRead,
    ProductionProcessCreate,
    ProductionProcessRead,
    ProductionProcessUpdate,
    ProductionRunCreate,
    ProductionRunRead,
    MaterialRejectPayload,
    ProductionRunStageFinish,
    ReceiveFinishedProductPayload,
    RunAssemblyDefine,
    RunCancelPayload,
    RunProductsUpdate,
    StageWeightEdit,
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


def _coverage_to_preview(coverage) -> AllocationPreviewRead:
    """_MaterialCoverage -> AllocationPreviewRead, compartido entre el
    preview de destinar y el de aprobar materiales (misma forma, mismo
    calculo de origen: ProductionService._compute_coverage)."""
    return AllocationPreviewRead(
        covered_qty=coverage.covered_qty,
        target_qty=coverage.target_qty,
        is_partial=coverage.is_partial,
        limiting_name=coverage.limiting_name,
        limiting_available=coverage.limiting_available,
        limiting_unit=coverage.limiting_unit,
        limiting_required_per_unit=coverage.limiting_required_per_unit,
        limiting_is_complement=coverage.limiting_is_complement,
        shortages=[
            MaterialShortageRead(
                name=s.name, unit=s.unit, available=s.available, needed=s.needed, is_complement=s.is_complement
            )
            for s in coverage.shortages
        ],
    )


ADMIN_ONLY_PRODUCTION_PERMISSIONS = {
    # Cancelar una orden y borrar una plantilla de proceso son exclusivos del
    # administrador -- ni el jefe de produccion pasa por el atajo generico de
    # abajo para estos dos permisos puntuales.
    "production.runs.delete": "Solo el administrador puede cancelar una orden de produccion.",
    "production.processes.delete": "Solo el administrador puede eliminar un proceso.",
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
    inventory_run_permissions = {"production.runs.read", "production.runs.update"}
    if current_user.role == "Jefe de inventario" and permission in inventory_run_permissions:
        return
    if is_admin or current_user.role in {"Jefe de produccion", "Jefe de producción"} and permission.startswith("production."):
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


@router.post("/runs/{run_id}/allocation-preview", response_model=AllocationPreviewRead)
def preview_run_allocation(
    run_id: UUID,
    payload: AllocateMaterialPayload,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> AllocationPreviewRead:
    """Dry-run: cuanto cubriria destinar esta cantidad. NO consume ni cambia
    estado -- alimenta la confirmacion previa del modal 'Destinar'."""
    ensure_permission(current_user, "production.runs.update")
    try:
        coverage = service.preview_allocation(run_id, payload.quantity_units)
    except ProductionNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ProductionDomainError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return _coverage_to_preview(coverage)


@router.get("/runs/{run_id}/approve-materials-preview", response_model=AllocationPreviewRead)
def preview_run_approve_materials(
    run_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> AllocationPreviewRead:
    """Dry-run: cuanto cubriria aprobar materiales HOY, con TODOS los
    recursos cortos (materia prima, complementos e insumos por etapa) --
    alimenta la confirmacion previa cuando la aprobacion va a quedar
    parcial y la orden se divide. NO consume ni cambia estado."""
    ensure_permission(current_user, "production.runs.update")
    try:
        coverage = service.preview_approve_materials(run_id)
    except ProductionNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ProductionDomainError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return _coverage_to_preview(coverage)


@router.post("/runs/{run_id}/reserve-material", response_model=ProductionRunRead)
def reserve_run_material(
    run_id: UUID,
    payload: AllocateMaterialPayload,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> ProductionRunRead:
    """Guarda el stock para esta orden sin consumirlo ni arrancarla."""
    ensure_permission(current_user, "production.runs.update")
    try:
        return service.reserve_material(run_id, payload.quantity_units, current_user)
    except ProductionNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ProductionDomainError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post("/runs/{run_id}/release-reservation", response_model=ProductionRunRead)
def release_run_reservation(
    run_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> ProductionRunRead:
    """Devuelve al disponible todo lo reservado por esta orden."""
    ensure_permission(current_user, "production.runs.update")
    try:
        return service.release_material_reservation(run_id, current_user)
    except ProductionNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ProductionDomainError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post("/runs/{run_id}/start-reserved", response_model=ProductionRunRead)
def start_run_with_reserved(
    run_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> ProductionRunRead:
    """Reserva completa: recien aqui se consume de verdad y arranca."""
    ensure_permission(current_user, "production.runs.update")
    try:
        return service.start_with_reserved_material(run_id, current_user)
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


@router.post("/runs/stages/{stage_id}/edit-weight", response_model=ProductionRunRead)
def edit_run_stage_weight(
    stage_id: UUID,
    payload: StageWeightEdit,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> ProductionRunRead:
    # Corrige un peso mal tipeado en una etapa ya finalizada (antes de recibir).
    ensure_permission(current_user, "production.runs.update")
    try:
        return service.edit_stage_weight(stage_id, payload, current_user)
    except ProductionNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ProductionDomainError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post("/runs/{run_id}/receive-finished", response_model=ProductionRunRead)
def receive_finished_product(
    run_id: UUID,
    payload: ReceiveFinishedProductPayload | None = None,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> ProductionRunRead:
    ensure_permission(current_user, "production.runs.update")
    try:
        return service.receive_finished_product(run_id, current_user, payload)
    except ProductionNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ProductionDomainError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post("/runs/{run_id}/additional-materials", response_model=ProductionRunRead)
def request_additional_material(
    run_id: UUID,
    payload: AdditionalMaterialRequestCreate,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> ProductionRunRead:
    ensure_permission(current_user, "production.runs.update")
    try:
        return service.request_additional_material(run_id, payload, current_user)
    except ProductionNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ProductionDomainError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post("/runs/additional-materials/{request_id}/approve", response_model=ProductionRunRead)
def approve_additional_material(
    request_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> ProductionRunRead:
    ensure_permission(current_user, "production.runs.update")
    try:
        return service.approve_additional_material(request_id, current_user)
    except ProductionNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ProductionDomainError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post("/runs/additional-materials/{request_id}/reject", response_model=ProductionRunRead)
def reject_additional_material(
    request_id: UUID,
    payload: MaterialRejectPayload | None = None,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> ProductionRunRead:
    ensure_permission(current_user, "production.runs.update")
    try:
        return service.reject_additional_material(request_id, payload.reason if payload else None, current_user)
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


@router.post("/runs/complements/{complement_id}/return", response_model=ProductionRunRead)
def return_complement(
    complement_id: UUID,
    payload: ComplementReturnCreate,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> ProductionRunRead:
    ensure_permission(current_user, "production.runs.update")
    try:
        return service.return_complement(complement_id, payload, current_user)
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


@router.delete("/assembly-recipes/{model_key}", status_code=status.HTTP_204_NO_CONTENT)
def delete_assembly_recipe(
    model_key: str,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> None:
    if current_user.role == "Jefe de inventario":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo produccion puede editar el plan.")
    ensure_permission(current_user, "production.runs.update")
    try:
        service.delete_assembly_recipe(model_key)
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
