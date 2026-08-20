"""Solicitud del admin + respuesta de Produccion/Inventario (Rodrigo,
2026-08-20): dos partes fijas, no un chat -- una sola respuesta por
solicitud, con decision obligatoria (APROBADA/RECHAZADA) y comentario
opcional."""
import pytest

from backend.modules.messages.schemas import AdminMessageCreate, AdminMessageReplyCreate
from backend.modules.messages.service import MessageDomainError


def test_reply_sets_decision_and_optional_comment(messages_service, admin_user, operaciones_user):
    message = messages_service.send_message(AdminMessageCreate(body="Necesito 500g de oro 18k"), admin_user)

    result = messages_service.reply_message(
        message.id, AdminMessageReplyCreate(decision="APROBADA", body="Ya se destino stock"), operaciones_user
    )

    assert len(result.replies) == 1
    assert result.replies[0].decision == "APROBADA"
    assert result.replies[0].body == "Ya se destino stock"


def test_reply_without_comment_is_allowed(messages_service, admin_user, operaciones_user):
    message = messages_service.send_message(AdminMessageCreate(body="Solicito revisar merma"), admin_user)

    result = messages_service.reply_message(
        message.id, AdminMessageReplyCreate(decision="RECHAZADA", body=None), operaciones_user
    )

    assert result.replies[0].decision == "RECHAZADA"
    assert result.replies[0].body is None


def test_second_reply_is_rejected(messages_service, admin_user, operaciones_user):
    message = messages_service.send_message(AdminMessageCreate(body="Solicitud unica"), admin_user)
    messages_service.reply_message(message.id, AdminMessageReplyCreate(decision="APROBADA", body=None), operaciones_user)

    with pytest.raises(MessageDomainError, match="ya fue respondida"):
        messages_service.reply_message(
            message.id, AdminMessageReplyCreate(decision="RECHAZADA", body=None), operaciones_user
        )
