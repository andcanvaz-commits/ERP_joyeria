"""acta persistida: production_run_acta_lines

Revision ID: d5e6f7a8b9c0
Revises: c4d5e6f7a8b9
Create Date: 2026-08-14 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "d5e6f7a8b9c0"
down_revision = "c4d5e6f7a8b9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "production_run_acta_lines",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "run_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("production_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "stage_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("production_run_stages.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("side", sa.String(20), nullable=False),
        sa.Column("label", sa.String(180), nullable=False),
        sa.Column("quantity", sa.Numeric(14, 4), nullable=False),
        sa.Column("unit_code", sa.String(20), nullable=False),
        sa.Column("source", sa.String(20), nullable=False, server_default="PLAN"),
        sa.Column("line_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column("note", sa.Text, nullable=True),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index(
        "ix_production_run_acta_lines_run_id",
        "production_run_acta_lines",
        ["run_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_production_run_acta_lines_run_id",
        table_name="production_run_acta_lines",
    )
    op.drop_table("production_run_acta_lines")
