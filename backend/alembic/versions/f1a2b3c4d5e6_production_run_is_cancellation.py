"""Distingue rechazo de solicitud (reject_materials) de cancelacion de una orden avanzada (cancel_run).

Revision ID: f1a2b3c4d5e6
Revises: e0f1a2b3c4d5
Create Date: 2026-08-15
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f1a2b3c4d5e6"
down_revision: Union[str, None] = "e0f1a2b3c4d5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "production_runs",
        sa.Column("is_cancellation", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.alter_column("production_runs", "is_cancellation", server_default=None)


def downgrade() -> None:
    op.drop_column("production_runs", "is_cancellation")
