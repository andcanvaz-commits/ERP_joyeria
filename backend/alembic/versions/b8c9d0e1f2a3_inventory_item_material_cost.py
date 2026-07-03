"""inventory_items: material_type, purity, average_cost

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-07-03
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "b8c9d0e1f2a3"
down_revision: Union[str, None] = "a7b8c9d0e1f2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column in {col["name"] for col in inspector.get_columns(table)}


def upgrade() -> None:
    if not _has_column("inventory_items", "material_type"):
        op.add_column("inventory_items", sa.Column("material_type", sa.String(length=80), nullable=True))
    if not _has_column("inventory_items", "purity"):
        op.add_column("inventory_items", sa.Column("purity", sa.String(length=40), nullable=True))
    if not _has_column("inventory_items", "average_cost"):
        op.add_column(
            "inventory_items",
            sa.Column("average_cost", sa.Numeric(precision=14, scale=4), nullable=False, server_default="0"),
        )
        op.alter_column("inventory_items", "average_cost", server_default=None)


def downgrade() -> None:
    for column in ("average_cost", "purity", "material_type"):
        if _has_column("inventory_items", column):
            op.drop_column("inventory_items", column)
