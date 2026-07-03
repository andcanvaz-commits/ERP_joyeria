"""proceso multi-material: tabla production_process_materials y drop de columna unica

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-07-03
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


# revision identifiers, used by Alembic.
revision: str = "f6a7b8c9d0e1"
down_revision: Union[str, None] = "e5f6a7b8c9d0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(table: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table)


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column in {col["name"] for col in inspector.get_columns(table)}


def upgrade() -> None:
    if not _has_table("production_process_materials"):
        op.create_table(
            "production_process_materials",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column("process_id", UUID(as_uuid=True), nullable=False, index=True),
            sa.Column("inventory_item_id", UUID(as_uuid=True), nullable=False),
            sa.Column("quantity_per_unit", sa.Numeric(precision=14, scale=4), nullable=False),
            sa.Column("unit_code", sa.String(length=20), nullable=False),
            sa.ForeignKeyConstraint(
                ["process_id"], ["production_processes.id"], ondelete="CASCADE"
            ),
        )
    for column in ("raw_material_item_id", "raw_material_quantity_per_unit", "raw_material_unit_code"):
        if _has_column("production_processes", column):
            op.drop_column("production_processes", column)


def downgrade() -> None:
    for column, coltype in (
        ("raw_material_item_id", UUID(as_uuid=True)),
        ("raw_material_quantity_per_unit", sa.Numeric(precision=14, scale=4)),
        ("raw_material_unit_code", sa.String(length=20)),
    ):
        if not _has_column("production_processes", column):
            op.add_column("production_processes", sa.Column(column, coltype, nullable=True))
    if _has_table("production_process_materials"):
        op.drop_table("production_process_materials")
