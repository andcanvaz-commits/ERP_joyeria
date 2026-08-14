"""devolucion complemento sobrante

Revision ID: 2532714c7bf8
Revises: e6f7a8b9c0d1
Create Date: 2026-08-14 18:07:29.689418
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '2532714c7bf8'
down_revision: Union[str, None] = 'e6f7a8b9c0d1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "production_complement_requests",
        sa.Column("returned_quantity", sa.Numeric(14, 4), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("production_complement_requests", "returned_quantity")
