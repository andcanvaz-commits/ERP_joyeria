"""inventory_items: source_lot_sku (conversion de lotes a productos)

Revision ID: f8a9b0c1d2e3
Revises: e7f8a9b0c1d2
Create Date: 2026-07-20
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "f8a9b0c1d2e3"
down_revision: Union[str, None] = "e7f8a9b0c1d2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column in {col["name"] for col in inspector.get_columns(table)}


def upgrade() -> None:
    if not _has_column("inventory_items", "source_lot_sku"):
        op.add_column("inventory_items", sa.Column("source_lot_sku", sa.String(30), nullable=True))
        op.create_index(
            "ix_inventory_items_source_lot_sku", "inventory_items", ["source_lot_sku"]
        )


def downgrade() -> None:
    if _has_column("inventory_items", "source_lot_sku"):
        op.drop_index("ix_inventory_items_source_lot_sku", table_name="inventory_items")
        op.drop_column("inventory_items", "source_lot_sku")
