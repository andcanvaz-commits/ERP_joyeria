from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from backend.modules.auth.dependencies import CurrentUser, get_current_user
from backend.modules.database.session import SessionLocal
from backend.modules.units.schemas import UnitCreate, UnitRead
from backend.modules.units.service import UnitError, UnitsService

router = APIRouter()


def get_units_service():
    session = SessionLocal()
    try:
        yield UnitsService(session)
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


@router.get("", response_model=list[UnitRead])
def list_units(
    current_user: CurrentUser = Depends(get_current_user),
    service: UnitsService = Depends(get_units_service),
) -> list[UnitRead]:
    return service.list_units()


@router.post("", response_model=UnitRead, status_code=status.HTTP_201_CREATED)
def create_unit(
    payload: UnitCreate,
    current_user: CurrentUser = Depends(get_current_user),
    service: UnitsService = Depends(get_units_service),
) -> UnitRead:
    try:
        return service.create_unit(payload)
    except UnitError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.delete("/{unit_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_unit(
    unit_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    service: UnitsService = Depends(get_units_service),
) -> None:
    try:
        service.delete_unit(unit_id)
    except UnitError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
