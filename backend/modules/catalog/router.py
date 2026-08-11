from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from backend.modules.auth.dependencies import CurrentUser, get_current_user
from backend.modules.catalog.schemas import CatalogSegmentCreate, CatalogSegmentRead
from backend.modules.catalog.service import CatalogError, CatalogSegmentInUseError, CatalogService
from backend.modules.database.session import SessionLocal

router = APIRouter()


# El catálogo (material/categoría/modelo) solo lo edita el administrador,
# igual que el resto de Mantenimiento (el frontend ya lo oculta para los
# demás roles en /mantenimientos -- ver frontend/lib/roles.ts). La lectura
# queda abierta a cualquier usuario autenticado porque inventario y
# producción la necesitan para sus propios formularios (elegir material,
# categoría, etc.).
def _ensure_admin(current_user: CurrentUser) -> None:
    if current_user.role not in {"admin", "Admin"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo el administrador puede modificar el catálogo.",
        )


def get_catalog_service():
    session = SessionLocal()
    try:
        yield CatalogService(session)
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


@router.get("/segments", response_model=list[CatalogSegmentRead])
def list_segments(
    current_user: CurrentUser = Depends(get_current_user),
    service: CatalogService = Depends(get_catalog_service),
) -> list[CatalogSegmentRead]:
    return service.list_segments()


@router.post("/segments", response_model=CatalogSegmentRead, status_code=status.HTTP_201_CREATED)
def create_segment(
    payload: CatalogSegmentCreate,
    current_user: CurrentUser = Depends(get_current_user),
    service: CatalogService = Depends(get_catalog_service),
) -> CatalogSegmentRead:
    _ensure_admin(current_user)
    try:
        return service.create_segment(payload)
    except CatalogError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.delete("/segments/{segment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_segment(
    segment_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    service: CatalogService = Depends(get_catalog_service),
) -> None:
    _ensure_admin(current_user)
    try:
        service.delete_segment(segment_id)
    except CatalogSegmentInUseError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except CatalogError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
