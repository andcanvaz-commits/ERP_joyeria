"""inventory_items: weight_per_unit (gramos por unidad segun la produccion)

Revision ID: d2e3f4a5b6c7
Revises: c1d2e3f4a5b6
Create Date: 2026-07-21
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "d2e3f4a5b6c7"
down_revision: Union[str, None] = "c1d2e3f4a5b6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column in {col["name"] for col in inspector.get_columns(table)}


def upgrade() -> None:
    if not _has_column("inventory_items", "weight_per_unit"):
        op.add_column("inventory_items", sa.Column("weight_per_unit", sa.Numeric(14, 4), nullable=True))


def downgrade() -> None:
    if _has_column("inventory_items", "weight_per_unit"):
        op.drop_column("inventory_items", "weight_per_unit")
