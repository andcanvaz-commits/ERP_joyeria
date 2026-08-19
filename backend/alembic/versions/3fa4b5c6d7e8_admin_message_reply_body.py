"""Mensajes admin: hilo de respuestas real (cualquiera de los dos lados
puede seguir contestando), no un unico aceptar/rechazar ni una unica
respuesta de texto.

Revision ID: 3fa4b5c6d7e8
Revises: 2ef338d9afa1
Create Date: 2026-08-19
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "3fa4b5c6d7e8"
down_revision: Union[str, None] = "2ef338d9afa1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "admin_message_replies",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "message_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("admin_messages.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("sender_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.drop_column("admin_messages", "status")
    op.drop_column("admin_messages", "responded_by_user_id")
    op.drop_column("admin_messages", "responded_at")


def downgrade() -> None:
    op.add_column("admin_messages", sa.Column("status", sa.String(20), nullable=False, server_default="PENDIENTE"))
    op.add_column("admin_messages", sa.Column("responded_by_user_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("admin_messages", sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True))
    op.alter_column("admin_messages", "status", server_default=None)
    op.drop_table("admin_message_replies")
