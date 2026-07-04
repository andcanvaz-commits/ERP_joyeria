"""inventory_items: total_weight, elaboration_date (productos terminados)

Revision ID: c9d0e1f2a3b4
Revises: b8c9d0e1f2a3
Create Date: 2026-07-03
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "c9d0e1f2a3b4"
down_revision: Union[str, None] = "b8c9d0e1f2a3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column in {col["name"] for col in inspector.get_columns(table)}


def upgrade() -> None:
    if not _has_column("inventory_items", "total_weight"):
        op.add_column("inventory_items", sa.Column("total_weight", sa.Numeric(precision=14, scale=4), nullable=True))
    if not _has_column("inventory_items", "elaboration_date"):
        op.add_column("inventory_items", sa.Column("elaboration_date", sa.Date(), nullable=True))


def downgrade() -> None:
    for column in ("elaboration_date", "total_weight"):
        if _has_column("inventory_items", column):
            op.drop_column("inventory_items", column)
