"""production_run_stage_attempt_decisions

Revision ID: cdfbfe522f3d
Revises: 832b3f0674de
Create Date: 2026-08-20 19:24:42.887000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'cdfbfe522f3d'
down_revision: Union[str, None] = '832b3f0674de'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "production_run_stage_attempt_decisions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "stage_attempt_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("production_run_stage_attempts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("decision", sa.String(length=20), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("decided_by_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_production_run_stage_attempt_decisions_stage_attempt_id",
        "production_run_stage_attempt_decisions",
        ["stage_attempt_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_production_run_stage_attempt_decisions_stage_attempt_id", table_name="production_run_stage_attempt_decisions")
    op.drop_table("production_run_stage_attempt_decisions")
