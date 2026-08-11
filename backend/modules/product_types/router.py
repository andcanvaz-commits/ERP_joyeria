from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from backend.modules.auth.dependencies import CurrentUser, get_current_user
from backend.modules.database.session import SessionLocal
from backend.modules.product_types.schemas import ProductTypeCreate, ProductTypeRead
from backend.modules.product_types.service import ProductTypeError, ProductTypeInUseError, ProductTypeService

router = APIRouter()


# Mismo criterio que catalog/units: solo admin escribe, lectura abierta a
# cualquier usuario autenticado (producción/inventario listan tipos de
# producto en sus propios formularios).
def _ensure_admin(current_user: CurrentUser) -> None:
    if current_user.role not in {"admin", "Admin"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo el administrador puede modificar los tipos de producto.",
        )


def get_product_type_service():
    session = SessionLocal()
    try:
        yield ProductTypeService(session)
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


@router.get("", response_model=list[ProductTypeRead])
def list_types(
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductTypeService = Depends(get_product_type_service),
) -> list[ProductTypeRead]:
    return service.list_types()


@router.post("", response_model=ProductTypeRead, status_code=status.HTTP_201_CREATED)
def create_type(
    payload: ProductTypeCreate,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductTypeService = Depends(get_product_type_service),
) -> ProductTypeRead:
    _ensure_admin(current_user)
    try:
        return service.create_type(payload)
    except ProductTypeError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc


@router.delete("/{type_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_type(
    type_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductTypeService = Depends(get_product_type_service),
) -> None:
    _ensure_admin(current_user)
    try:
        service.delete_type(type_id)
    except ProductTypeInUseError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except ProductTypeError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
