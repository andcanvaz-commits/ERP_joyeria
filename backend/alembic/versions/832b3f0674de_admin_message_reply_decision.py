"""admin message reply decision

Revision ID: 832b3f0674de
Revises: 0bb423e87ec9
Create Date: 2026-08-20 04:45:32.248896
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '832b3f0674de'
down_revision: Union[str, None] = '0bb423e87ec9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("admin_message_replies", sa.Column("decision", sa.Text(), nullable=True))
    # Respuestas viejas (chat libre, sin decision) quedan marcadas APROBADA
    # por defecto -- no hay forma de inferir su intencion real.
    op.execute("UPDATE admin_message_replies SET decision = 'APROBADA' WHERE decision IS NULL")
    op.alter_column("admin_message_replies", "decision", nullable=False)
    op.alter_column("admin_message_replies", "body", nullable=True)


def downgrade() -> None:
    op.execute("UPDATE admin_message_replies SET body = '' WHERE body IS NULL")
    op.alter_column("admin_message_replies", "body", nullable=False)
    op.drop_column("admin_message_replies", "decision")
