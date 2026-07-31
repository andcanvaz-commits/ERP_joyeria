"""produccion parcial: split de ordenes por falta de materia prima

Revision ID: b7c8d9e0f1a2
Revises: d8e9f0a1b2c3
Create Date: 2026-07-31
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "b7c8d9e0f1a2"
down_revision = "d8e9f0a1b2c3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "production_runs",
        sa.Column("root_production_code", sa.String(30), nullable=True),
    )
    op.add_column(
        "production_runs",
        sa.Column(
            "parent_run_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("production_runs.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_production_runs_root_production_code",
        "production_runs",
        ["root_production_code"],
    )
    # production_code deja de ser unico: una orden partida por falta de
    # materia prima genera corridas hijas con el mismo folio raiz y un
    # sufijo propio (OP-2026-0001-B). El folio raiz es el "certificado".
    op.drop_index("ix_production_runs_production_code", table_name="production_runs")
    op.create_index(
        "ix_production_runs_production_code",
        "production_runs",
        ["production_code"],
    )
    op.execute("UPDATE production_runs SET root_production_code = production_code")


def downgrade() -> None:
    op.drop_index("ix_production_runs_production_code", table_name="production_runs")
    op.create_index(
        "ix_production_runs_production_code",
        "production_runs",
        ["production_code"],
        unique=True,
    )
    op.drop_index("ix_production_runs_root_production_code", table_name="production_runs")
    op.drop_column("production_runs", "parent_run_id")
    op.drop_column("production_runs", "root_production_code")
