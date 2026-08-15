"""Quitar precio referencial de tipos de producto terminado.

Revision ID: d9e0f1a2b3c4
Revises: c96088e1333d
Create Date: 2026-08-15
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d9e0f1a2b3c4"
down_revision: Union[str, None] = "c96088e1333d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column("product_types", "price")


def downgrade() -> None:
    op.add_column("product_types", sa.Column("price", sa.Numeric(14, 2), nullable=True))
