"""drop product_code de production_processes y production_runs

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-07-03
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "e5f6a7b8c9d0"
down_revision: Union[str, None] = "d4e5f6a7b8c9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column(table: str, column: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column in {col["name"] for col in inspector.get_columns(table)}


def upgrade() -> None:
    for table in ("production_processes", "production_runs"):
        if _has_column(table, "product_code"):
            op.drop_column(table, "product_code")


def downgrade() -> None:
    for table in ("production_processes", "production_runs"):
        if not _has_column(table, "product_code"):
            op.add_column(
                table,
                sa.Column("product_code", sa.String(length=20), nullable=True),
            )
