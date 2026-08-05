"""production_runs: event_lines historicas + nombre de responsable en texto

Revision ID: b1c2d3e4f5a6
Revises: c8d9e0f1a2b3
Create Date: 2026-08-04
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "b1c2d3e4f5a6"
down_revision: Union[str, None] = "c8d9e0f1a2b3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(table: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return table in inspector.get_table_names()


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column in {col["name"] for col in inspector.get_columns(table)}


def upgrade() -> None:
    if not _has_column("production_runs", "materials_approved_responsable_name"):
        op.add_column(
            "production_runs",
            sa.Column("materials_approved_responsable_name", sa.String(180), nullable=True),
        )
    if not _has_column("production_runs", "received_responsable_name"):
        op.add_column(
            "production_runs",
            sa.Column("received_responsable_name", sa.String(180), nullable=True),
        )
    if not _has_table("production_run_event_lines"):
        op.create_table(
            "production_run_event_lines",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column(
                "run_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("production_runs.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("side", sa.String(20), nullable=False),
            sa.Column("gramos", sa.Numeric(14, 4), nullable=False),
            sa.Column("unidad", sa.String(20), nullable=False),
            sa.Column("detalle", sa.Text(), nullable=True),
            sa.Column("line_order", sa.Integer(), nullable=False, server_default="0"),
        )
        op.create_index(
            "ix_production_run_event_lines_run_id",
            "production_run_event_lines",
            ["run_id"],
        )


def downgrade() -> None:
    if _has_table("production_run_event_lines"):
        op.drop_index("ix_production_run_event_lines_run_id", table_name="production_run_event_lines")
        op.drop_table("production_run_event_lines")
    if _has_column("production_runs", "received_responsable_name"):
        op.drop_column("production_runs", "received_responsable_name")
    if _has_column("production_runs", "materials_approved_responsable_name"):
        op.drop_column("production_runs", "materials_approved_responsable_name")
