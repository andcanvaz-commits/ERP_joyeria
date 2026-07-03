"""add initial_weight/final_weight to production_process_stages

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-07-03
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "b2c3d4e5f6a7"
down_revision: Union[str, None] = "a1b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column(table: str, column: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column in {col["name"] for col in inspector.get_columns(table)}


def upgrade() -> None:
    # Idempotente: la tabla pudo crearse via create_all sin estas columnas.
    if not _has_column("production_process_stages", "initial_weight"):
        op.add_column(
            "production_process_stages",
            sa.Column("initial_weight", sa.Numeric(precision=14, scale=4), nullable=True),
        )
    if not _has_column("production_process_stages", "final_weight"):
        op.add_column(
            "production_process_stages",
            sa.Column("final_weight", sa.Numeric(precision=14, scale=4), nullable=True),
        )


def downgrade() -> None:
    if _has_column("production_process_stages", "final_weight"):
        op.drop_column("production_process_stages", "final_weight")
    if _has_column("production_process_stages", "initial_weight"):
        op.drop_column("production_process_stages", "initial_weight")
