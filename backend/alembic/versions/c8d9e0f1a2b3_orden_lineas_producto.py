"""orden explicito de lineas de producto en production_run_products

Revision ID: c8d9e0f1a2b3
Revises: b7c8d9e0f1a2
Create Date: 2026-07-31
"""
import sqlalchemy as sa
from alembic import op

revision = "c8d9e0f1a2b3"
down_revision = "b7c8d9e0f1a2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "production_run_products",
        sa.Column("line_order", sa.Integer(), nullable=False, server_default="0"),
    )
    # Backfill: orden estable por fila existente dentro de cada orden (mejor
    # que dejar todo en 0, aunque el orden historico exacto no se conservo).
    op.execute(
        """
        UPDATE production_run_products AS p
        SET line_order = sub.rn - 1
        FROM (
            SELECT id, ROW_NUMBER() OVER (PARTITION BY run_id ORDER BY id) AS rn
            FROM production_run_products
        ) AS sub
        WHERE p.id = sub.id
        """
    )
    op.alter_column("production_run_products", "line_order", server_default=None)


def downgrade() -> None:
    op.drop_column("production_run_products", "line_order")
