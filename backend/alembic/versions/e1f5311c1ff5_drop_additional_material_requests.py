"""drop_additional_material_requests

Revision ID: e1f5311c1ff5
Revises: b9d4bfe1af89
Create Date: 2026-08-20 00:29:09.520279
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e1f5311c1ff5'
down_revision: Union[str, None] = 'b9d4bfe1af89'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_table("production_run_additional_material_requests")


def downgrade() -> None:
    raise NotImplementedError("No hay vuelta atras: la tabla se elimina sin conservar datos.")
