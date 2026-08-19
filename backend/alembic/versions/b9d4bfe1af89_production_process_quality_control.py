"""production_process_quality_control

Revision ID: b9d4bfe1af89
Revises: aa5eab213dd8
Create Date: 2026-08-19 23:57:00.671096
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b9d4bfe1af89'
down_revision: Union[str, None] = 'aa5eab213dd8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "production_processes",
        sa.Column("quality_control", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("production_processes", "quality_control")
