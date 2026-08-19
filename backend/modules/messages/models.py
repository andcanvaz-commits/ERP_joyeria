from datetime import datetime
from uuid import UUID as PyUUID, uuid4

from sqlalchemy import DateTime, String, Text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from backend.modules.database.base import Base


class AdminMessageStatus:
    PENDING = "PENDIENTE"
    ACCEPTED = "ACEPTADA"
    REJECTED = "RECHAZADA"


class AdminMessage(Base):
    """Mensaje libre del Admin a la bandeja de Solicitudes de Produccion/
    Inventario (docs/cambios-sistema-produccion.md seccion 2.2). Es solo
    comunicacion -- no crea ninguna orden de produccion por si mismo. Historial
    permanente, nunca se borra."""

    __tablename__ = "admin_messages"

    id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    sender_user_id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=AdminMessageStatus.PENDING)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    responded_by_user_id: Mapped[PyUUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
