from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from backend.modules.auth.dependencies import CurrentUser, get_current_user
from backend.modules.production.schemas import ProductionOrderCreate, ProductionOrderRead
from backend.modules.production.service import ProductionService


router = APIRouter()


def get_production_service() -> ProductionService:
    raise NotImplementedError("Wire database session and inventory port in composition root.")


@router.post("/orders", response_model=ProductionOrderRead, status_code=status.HTTP_201_CREATED)
def create_order(
    payload: ProductionOrderCreate,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> ProductionOrderRead:
    return service.create_order(payload, current_user)


@router.post("/orders/{order_id}/start", response_model=ProductionOrderRead)
def start_order(
    order_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> ProductionOrderRead:
    try:
        return service.start_order(order_id, current_user)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
