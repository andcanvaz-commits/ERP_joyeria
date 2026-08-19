from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from backend.modules.auth.dependencies import CurrentUser, get_current_user
from backend.modules.database.session import SessionLocal
from backend.modules.messages.schemas import AdminMessageCreate, AdminMessageRead, AdminMessageRespond
from backend.modules.messages.service import MessageDomainError, MessageNotFoundError, MessagesService

router = APIRouter()


def get_messages_service():
    session = SessionLocal()
    try:
        yield MessagesService(session)
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def _ensure_admin(current_user: CurrentUser) -> None:
    if current_user.role not in {"admin", "Admin"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo el administrador puede enviar mensajes a Produccion/Inventario.",
        )


def _ensure_production_inventory(current_user: CurrentUser) -> None:
    if current_user.role != "Producción/Inventario":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo Produccion/Inventario puede responder este mensaje.",
        )


@router.get("", response_model=list[AdminMessageRead])
def list_messages(
    current_user: CurrentUser = Depends(get_current_user),
    service: MessagesService = Depends(get_messages_service),
) -> list[AdminMessageRead]:
    return service.list_messages()


@router.post("", response_model=AdminMessageRead, status_code=status.HTTP_201_CREATED)
def send_message(
    payload: AdminMessageCreate,
    current_user: CurrentUser = Depends(get_current_user),
    service: MessagesService = Depends(get_messages_service),
) -> AdminMessageRead:
    _ensure_admin(current_user)
    return service.send_message(payload, current_user)


@router.post("/{message_id}/respond", response_model=AdminMessageRead)
def respond_message(
    message_id: UUID,
    payload: AdminMessageRespond,
    current_user: CurrentUser = Depends(get_current_user),
    service: MessagesService = Depends(get_messages_service),
) -> AdminMessageRead:
    _ensure_production_inventory(current_user)
    try:
        return service.respond_message(message_id, payload, current_user)
    except MessageNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except MessageDomainError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
