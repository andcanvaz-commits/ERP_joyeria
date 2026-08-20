"""stage_attempt_product_target

Revision ID: 0bb423e87ec9
Revises: e1f5311c1ff5
Create Date: 2026-08-20 02:29:56.884729
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0bb423e87ec9'
down_revision: Union[str, None] = 'e1f5311c1ff5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "production_run_stage_attempts",
        sa.Column("target_product_type_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "production_run_stage_attempts",
        sa.Column("target_item_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_stage_attempts_target_product_type",
        "production_run_stage_attempts",
        "product_types",
        ["target_product_type_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_stage_attempts_target_product_type", "production_run_stage_attempts", type_="foreignkey")
    op.drop_column("production_run_stage_attempts", "target_item_id")
    op.drop_column("production_run_stage_attempts", "target_product_type_id")
