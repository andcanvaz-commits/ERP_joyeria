from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from backend.modules.auth.dependencies import CurrentUser, get_current_user
from backend.modules.database.session import SessionLocal
from backend.modules.product_types.schemas import ProductTypeCreate, ProductTypeRead
from backend.modules.product_types.service import ProductTypeError, ProductTypeService

router = APIRouter()


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
    try:
        service.delete_type(type_id)
    except ProductTypeError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
