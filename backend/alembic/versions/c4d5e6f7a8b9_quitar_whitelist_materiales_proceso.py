"""quitar whitelist de materiales por proceso: cualquier materia prima sirve

Revision ID: c4d5e6f7a8b9
Revises: b3c4d5e6f7a8
Create Date: 2026-08-14 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "c4d5e6f7a8b9"
down_revision = "b3c4d5e6f7a8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_table("production_process_materials")


def downgrade() -> None:
    op.create_table(
        "production_process_materials",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "process_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("production_processes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("inventory_item_id", postgresql.UUID(as_uuid=True), nullable=False),
    )
    op.create_index(
        "ix_production_process_materials_process_id",
        "production_process_materials",
        ["process_id"],
    )
