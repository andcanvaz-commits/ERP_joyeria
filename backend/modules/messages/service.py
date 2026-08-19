from typing import Literal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from backend.modules.auth.dependencies import CurrentUser
from backend.modules.messages.models import AdminMessage, AdminMessageReply
from backend.modules.messages.schemas import AdminMessageCreate, AdminMessageRead, AdminMessageReplyCreate

MessageScope = Literal["solicitudes", "inventario"]


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
            created_at=message.created_at,
            replies=[
                {
                    "id": reply.id,
                    "sender_user_id": reply.sender_user_id,
                    "sender_name": names.get(reply.sender_user_id),
                    "body": reply.body,
                    "created_at": reply.created_at,
                }
                for reply in message.replies
            ],
        )

    def send_message(self, payload: AdminMessageCreate, current_user: CurrentUser) -> AdminMessageRead:
        message = AdminMessage(sender_user_id=current_user.id, body=payload.body.strip())
        self.session.add(message)
        self.session.flush()
        names = _resolve_user_names(self.session, [current_user.id])
        return self._read(message, names)

    def list_messages(self, scope: MessageScope) -> list[AdminMessageRead]:
        hidden_column = (
            AdminMessage.hidden_from_solicitudes if scope == "solicitudes" else AdminMessage.hidden_from_inventario
        )
        messages = (
            self.session.execute(
                select(AdminMessage)
                .options(selectinload(AdminMessage.replies))
                .where(hidden_column.is_(False))
                .order_by(AdminMessage.created_at.desc())
            )
            .scalars()
            .all()
        )
        user_ids = [m.sender_user_id for m in messages]
        for m in messages:
            user_ids.extend(reply.sender_user_id for reply in m.replies)
        names = _resolve_user_names(self.session, user_ids)
        return [self._read(m, names) for m in messages]

    def delete_message(self, message_id: UUID, scope: MessageScope) -> None:
        message = self.session.get(AdminMessage, message_id)
        if message is None:
            raise MessageNotFoundError("Mensaje no encontrado.")
        if scope == "solicitudes":
            message.hidden_from_solicitudes = True
        else:
            message.hidden_from_inventario = True
        if message.hidden_from_solicitudes and message.hidden_from_inventario:
            self.session.delete(message)
        self.session.flush()

    def reply_message(
        self, message_id: UUID, payload: AdminMessageReplyCreate, current_user: CurrentUser
    ) -> AdminMessageRead:
        message = self.session.execute(
            select(AdminMessage).options(selectinload(AdminMessage.replies)).where(AdminMessage.id == message_id)
        ).scalar_one_or_none()
        if message is None:
            raise MessageNotFoundError("Mensaje no encontrado.")
        reply = AdminMessageReply(message_id=message.id, sender_user_id=current_user.id, body=payload.body.strip())
        self.session.add(reply)
        self.session.flush()
        message.replies.append(reply)
        user_ids = [message.sender_user_id] + [r.sender_user_id for r in message.replies]
        names = _resolve_user_names(self.session, user_ids)
        return self._read(message, names)
