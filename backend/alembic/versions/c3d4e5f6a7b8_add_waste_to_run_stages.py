"""add waste_weight/waste_percent to production_run_stages

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-07-03
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "c3d4e5f6a7b8"
down_revision: Union[str, None] = "b2c3d4e5f6a7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column(table: str, column: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column in {col["name"] for col in inspector.get_columns(table)}


def upgrade() -> None:
    # Idempotente: la tabla pudo crearse via create_all sin estas columnas.
    if not _has_column("production_run_stages", "waste_weight"):
        op.add_column(
            "production_run_stages",
            sa.Column("waste_weight", sa.Numeric(precision=14, scale=4), nullable=True),
        )
    if not _has_column("production_run_stages", "waste_percent"):
        op.add_column(
            "production_run_stages",
            sa.Column("waste_percent", sa.Numeric(precision=7, scale=4), nullable=True),
        )


def downgrade() -> None:
    if _has_column("production_run_stages", "waste_percent"):
        op.drop_column("production_run_stages", "waste_percent")
    if _has_column("production_run_stages", "waste_weight"):
        op.drop_column("production_run_stages", "waste_weight")
