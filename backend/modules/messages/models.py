from datetime import datetime
from uuid import UUID as PyUUID, uuid4

from sqlalchemy import Boolean, DateTime, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.modules.database.base import Base


class AdminMessage(Base):
    """Hilo de mensajes libres Admin <-> Produccion/Inventario
    (docs/cambios-sistema-produccion.md seccion 2.2): cualquiera de los dos
    lados puede seguir respondiendo, no es una unica ida y vuelta.

    Eliminar es por superficie, no global: "Bandeja de mensajes" (solicitudes)
    e "Inventario" son dos vistas de la misma conversacion, pero borrar desde
    una no debe hacerla desaparecer de la otra. Se oculta con un flag por
    superficie; solo se borra la fila de verdad cuando ambas la ocultaron."""

    __tablename__ = "admin_messages"

    id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    sender_user_id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    hidden_from_solicitudes: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    hidden_from_inventario: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    replies: Mapped[list["AdminMessageReply"]] = relationship(
        "AdminMessageReply",
        back_populates="message",
        order_by="AdminMessageReply.created_at",
        cascade="all, delete-orphan",
    )


class AdminMessageReply(Base):
    __tablename__ = "admin_message_replies"

    id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    message_id: Mapped[PyUUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("admin_messages.id", ondelete="CASCADE"), nullable=False
    )
    sender_user_id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    message: Mapped[AdminMessage] = relationship("AdminMessage", back_populates="replies")
