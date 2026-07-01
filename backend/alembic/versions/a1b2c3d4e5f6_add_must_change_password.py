"""add must_change_password to auth_users

Revision ID: a1b2c3d4e5f6
Revises: c1d2a9006895
Create Date: 2026-07-01
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "c1d2a9006895"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "auth_users",
        sa.Column(
            "must_change_password",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    # Quita el default a nivel de servidor; la aplicacion controla el valor.
    op.alter_column("auth_users", "must_change_password", server_default=None)


def downgrade() -> None:
    op.drop_column("auth_users", "must_change_password")
