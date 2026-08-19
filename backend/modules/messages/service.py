from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.modules.auth.dependencies import CurrentUser
from backend.modules.messages.models import AdminMessage, AdminMessageStatus
from backend.modules.messages.schemas import AdminMessageCreate, AdminMessageRead, AdminMessageRespond


class MessageDomainError(ValueError):
    pass


class MessageNotFoundError(LookupError):
    pass


def _resolve_user_names(session: Session, user_ids: list) -> dict:
    if not user_ids:
        return {}
    from backend.modules.auth.models import AuthUser

    unique_ids = list({uid for uid in user_ids if uid})
    if not unique_ids:
        return {}
    users = session.execute(select(AuthUser).where(AuthUser.id.in_(unique_ids))).scalars().all()
    result = {}
    for user in users:
        name = f"{user.first_name or ''} {user.last_name or ''}".strip()
        result[user.id] = name or user.username
    return result


class MessagesService:
    def __init__(self, session: Session) -> None:
        self.session = session

    def _read(self, message: AdminMessage, names: dict) -> AdminMessageRead:
        return AdminMessageRead(
            id=message.id,
            sender_user_id=message.sender_user_id,
            sender_name=names.get(message.sender_user_id),
            body=message.body,
            status=message.status,
            created_at=message.created_at,
            responded_by_user_id=message.responded_by_user_id,
            responded_by_name=names.get(message.responded_by_user_id) if message.responded_by_user_id else None,
            responded_at=message.responded_at,
        )

    def send_message(self, payload: AdminMessageCreate, current_user: CurrentUser) -> AdminMessageRead:
        message = AdminMessage(sender_user_id=current_user.id, body=payload.body.strip())
        self.session.add(message)
        self.session.flush()
        names = _resolve_user_names(self.session, [current_user.id])
        return self._read(message, names)

    def list_messages(self) -> list[AdminMessageRead]:
        messages = (
            self.session.execute(select(AdminMessage).order_by(AdminMessage.created_at.desc()))
            .scalars()
            .all()
        )
        user_ids = [m.sender_user_id for m in messages] + [m.responded_by_user_id for m in messages if m.responded_by_user_id]
        names = _resolve_user_names(self.session, user_ids)
        return [self._read(m, names) for m in messages]

    def respond_message(
        self, message_id: UUID, payload: AdminMessageRespond, current_user: CurrentUser
    ) -> AdminMessageRead:
        message = self.session.get(AdminMessage, message_id)
        if message is None:
            raise MessageNotFoundError("Mensaje no encontrado.")
        if message.status != AdminMessageStatus.PENDING:
            raise MessageDomainError("Este mensaje ya fue respondido.")
        message.status = payload.status
        message.responded_by_user_id = current_user.id
        message.responded_at = datetime.utcnow()
        self.session.flush()
        names = _resolve_user_names(self.session, [message.sender_user_id, current_user.id])
        return self._read(message, names)
