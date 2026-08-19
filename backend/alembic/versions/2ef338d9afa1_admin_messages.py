"""Mensaje libre del Admin a la bandeja de Solicitudes de Produccion/
Inventario (docs/cambios-sistema-produccion.md seccion 2.2).

Revision ID: 2ef338d9afa1
Revises: 02931dbd57ba
Create Date: 2026-08-18
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "2ef338d9afa1"
down_revision: Union[str, None] = "02931dbd57ba"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "admin_messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("sender_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("responded_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("admin_messages")
