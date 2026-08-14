"""item id en lineas de acta

Revision ID: c96088e1333d
Revises: 2532714c7bf8
Create Date: 2026-08-14 19:38:08.667049
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'c96088e1333d'
down_revision: Union[str, None] = '2532714c7bf8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "production_run_acta_lines",
        sa.Column("item_id", postgresql.UUID(as_uuid=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("production_run_acta_lines", "item_id")
