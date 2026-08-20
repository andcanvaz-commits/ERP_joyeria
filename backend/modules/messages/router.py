from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from backend.modules.auth.dependencies import CurrentUser, get_current_user
from backend.modules.database.session import SessionLocal
from backend.modules.messages.schemas import AdminMessageCreate, AdminMessageRead, AdminMessageReplyCreate
from backend.modules.messages.service import MessageDomainError, MessageNotFoundError, MessageScope, MessagesService

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


def _ensure_responder(current_user: CurrentUser) -> None:
    # Admin tambien puede responder (Rodrigo, 2026-08-20: "en inventario no me
    # deja responder") -- en equipos chicos la misma cuenta admin hace de
    # inventario. El frontend solo muestra el boton en la superficie de
    # Inventario para no invitar a auto-aprobarse desde Solicitudes.
    if current_user.role not in {"admin", "Admin", "Producción/Inventario"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo Producción/Inventario puede responder una solicitud.",
        )


@router.get("", response_model=list[AdminMessageRead])
def list_messages(
    scope: MessageScope = Query(...),
    current_user: CurrentUser = Depends(get_current_user),
    service: MessagesService = Depends(get_messages_service),
) -> list[AdminMessageRead]:
    return service.list_messages(scope)


@router.post("", response_model=AdminMessageRead, status_code=status.HTTP_201_CREATED)
def send_message(
    payload: AdminMessageCreate,
    current_user: CurrentUser = Depends(get_current_user),
    service: MessagesService = Depends(get_messages_service),
) -> AdminMessageRead:
    _ensure_admin(current_user)
    return service.send_message(payload, current_user)


@router.delete("/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_message(
    message_id: UUID,
    scope: MessageScope = Query(...),
    current_user: CurrentUser = Depends(get_current_user),
    service: MessagesService = Depends(get_messages_service),
) -> None:
    _ensure_admin(current_user)
    try:
        service.delete_message(message_id, scope)
    except MessageNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post("/{message_id}/reply", response_model=AdminMessageRead)
def reply_message(
    message_id: UUID,
    payload: AdminMessageReplyCreate,
    current_user: CurrentUser = Depends(get_current_user),
    service: MessagesService = Depends(get_messages_service),
) -> AdminMessageRead:
    _ensure_responder(current_user)
    try:
        return service.reply_message(message_id, payload, current_user)
    except MessageNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except MessageDomainError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
