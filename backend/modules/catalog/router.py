from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from backend.modules.auth.dependencies import CurrentUser, get_current_user
from backend.modules.catalog.schemas import CatalogSegmentCreate, CatalogSegmentRead
from backend.modules.catalog.service import CatalogError, CatalogService
from backend.modules.database.session import SessionLocal

router = APIRouter()


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
    try:
        service.delete_segment(segment_id)
    except CatalogError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
