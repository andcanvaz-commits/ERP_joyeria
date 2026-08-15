"""Rastrea que corrida creo cada receta de ensamble, para poder borrarla si esa corrida se cancela.

Revision ID: e0f1a2b3c4d5
Revises: d9e0f1a2b3c4
Create Date: 2026-08-15
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "e0f1a2b3c4d5"
down_revision: Union[str, None] = "d9e0f1a2b3c4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "assembly_recipes",
        sa.Column("created_by_run_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_assembly_recipes_created_by_run_id",
        "assembly_recipes",
        "production_runs",
        ["created_by_run_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_assembly_recipes_created_by_run_id", "assembly_recipes", type_="foreignkey")
    op.drop_column("assembly_recipes", "created_by_run_id")
