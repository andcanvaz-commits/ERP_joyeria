"""Mensajes admin: eliminar es por superficie (Bandeja de mensajes vs
Inventario), no global. Se agregan flags de ocultamiento por lado.

Revision ID: 4a5b6c7d8e9f
Revises: 3fa4b5c6d7e8
Create Date: 2026-08-19
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "4a5b6c7d8e9f"
down_revision: Union[str, None] = "3fa4b5c6d7e8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "admin_messages",
        sa.Column("hidden_from_solicitudes", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "admin_messages",
        sa.Column("hidden_from_inventario", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.alter_column("admin_messages", "hidden_from_solicitudes", server_default=None)
    op.alter_column("admin_messages", "hidden_from_inventario", server_default=None)


def downgrade() -> None:
    op.drop_column("admin_messages", "hidden_from_inventario")
    op.drop_column("admin_messages", "hidden_from_solicitudes")
