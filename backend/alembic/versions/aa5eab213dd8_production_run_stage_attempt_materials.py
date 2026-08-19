"""production_run_stage_attempt_materials

Revision ID: aa5eab213dd8
Revises: 4a5b6c7d8e9f
Create Date: 2026-08-19 20:22:47.088376
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'aa5eab213dd8'
down_revision: Union[str, None] = '4a5b6c7d8e9f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "production_run_stage_attempt_materials",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "stage_attempt_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("production_run_stage_attempts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("item_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("unit_code", sa.String(length=20), nullable=False),
        sa.Column("quantity_requested", sa.Numeric(14, 4), nullable=False),
        sa.Column("quantity_pending", sa.Numeric(14, 4), nullable=False),
    )
    op.create_index(
        "ix_production_run_stage_attempt_materials_stage_attempt_id",
        "production_run_stage_attempt_materials",
        ["stage_attempt_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_production_run_stage_attempt_materials_stage_attempt_id",
        table_name="production_run_stage_attempt_materials",
    )
    op.drop_table("production_run_stage_attempt_materials")
