"""drop estimated_minutes de las etapas de proceso y de corrida

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-07-03
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "d4e5f6a7b8c9"
down_revision: Union[str, None] = "c3d4e5f6a7b8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column(table: str, column: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column in {col["name"] for col in inspector.get_columns(table)}


def upgrade() -> None:
    for table in ("production_process_stages", "production_run_stages"):
        if _has_column(table, "estimated_minutes"):
            op.drop_column(table, "estimated_minutes")


def downgrade() -> None:
    for table in ("production_process_stages", "production_run_stages"):
        if not _has_column(table, "estimated_minutes"):
            op.add_column(
                table,
                sa.Column("estimated_minutes", sa.Integer(), nullable=True),
            )
