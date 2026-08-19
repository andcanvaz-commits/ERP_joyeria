"""Flujo dinamico de produccion (docs/cambios-sistema-produccion.md secciones
2.3, 3, 4, 5, 8): banco de procesos aplanado + intentos de etapa nuevos.

No borra ninguna orden historica ni sus etapas (ProductionRun/
ProductionRunStage sobreviven intactas). Solo borra las tablas de
CONFIGURACION del proceso viejo (multi-etapa, sin valor historico propio --
lo ya ejecutado quedo copiado en production_run_stages) y agrega lo nuevo.

Revision ID: 02931dbd57ba
Revises: 83359a844e19
Create Date: 2026-08-18
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "02931dbd57ba"
down_revision: Union[str, None] = "83359a844e19"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- Banco de procesos: aplanar ProductionProcess, borrar sub-etapas ---
    op.drop_table("production_process_stage_ingredients")
    op.drop_table("production_process_stages")
    op.drop_table("production_process_product_types")
    op.drop_column("production_processes", "version")
    op.drop_column("production_processes", "waste_limit_percent")

    # --- ProductionRun: columnas del flujo viejo pasan a opcionales, mas el
    # nombre libre del flujo nuevo ---
    op.add_column("production_runs", sa.Column("name", sa.String(255), nullable=True))
    op.alter_column("production_runs", "process_id", nullable=True)
    op.alter_column("production_runs", "process_name", nullable=True)
    op.alter_column("production_runs", "quantity", nullable=True)
    op.alter_column("production_runs", "raw_material_unit_code", nullable=True)
    op.alter_column("production_runs", "total_required_material", nullable=True)
    op.alter_column("production_runs", "waste_limit_percent", nullable=True)
    op.alter_column("production_runs", "expected_finished_weight", nullable=True)

    # --- Intentos de etapa (flujo nuevo) ---
    op.create_table(
        "production_run_stage_attempts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "run_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("production_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "process_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("production_processes.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("process_name", sa.String(180), nullable=False),
        sa.Column("sequence_order", sa.Integer(), nullable=False),
        sa.Column("attempt_no_for_process", sa.Integer(), nullable=False),
        sa.Column("code", sa.String(60), nullable=True),
        sa.Column("responsable_name", sa.String(180), nullable=True),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("rejection_reason", sa.Text(), nullable=True),
        sa.Column("peso_al_finalizar", sa.Numeric(14, 4), nullable=True),
        sa.Column("unit_code", sa.String(20), nullable=True),
        sa.Column("merma_weight", sa.Numeric(14, 4), nullable=True),
        sa.Column("merma_percent", sa.Numeric(7, 4), nullable=True),
        sa.Column("started_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_production_run_stage_attempts_run_id", "production_run_stage_attempts", ["run_id"]
    )

    op.add_column(
        "production_run_acta_lines",
        sa.Column(
            "stage_attempt_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("production_run_stage_attempts.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    # Irreversible por diseno, igual que las migraciones anteriores de esta
    # misma serie de cambios.
    pass
