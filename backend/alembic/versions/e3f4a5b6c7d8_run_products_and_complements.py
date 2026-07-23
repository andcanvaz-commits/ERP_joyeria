"""run products plan and complement requests

Revision ID: e3f4a5b6c7d8
Revises: d2e3f4a5b6c7
Create Date: 2026-07-23
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "e3f4a5b6c7d8"
down_revision = "d2e3f4a5b6c7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "production_run_products",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "run_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("production_runs.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "product_type_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("product_types.id", ondelete="RESTRICT"),
            nullable=False,
            index=True,
        ),
        sa.Column("quantity", sa.Numeric(14, 4), nullable=False),
    )
    op.create_table(
        "production_complement_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "run_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("production_runs.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("item_id", postgresql.UUID(as_uuid=True), nullable=False, index=True),
        sa.Column("quantity", sa.Numeric(14, 4), nullable=False),
        sa.Column("unit_code", sa.String(20), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="PENDIENTE"),
        sa.Column("approved_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
    )
    # Migrar el producto objetivo único existente como plan de una sola fila
    # (cantidad = cantidad de la orden). El campo viejo queda deprecado.
    op.execute(
        """
        INSERT INTO production_run_products (id, run_id, product_type_id, quantity)
        SELECT gen_random_uuid(), id, target_product_type_id, quantity
        FROM production_runs
        WHERE target_product_type_id IS NOT NULL
        """
    )


def downgrade() -> None:
    op.drop_table("production_complement_requests")
    op.drop_table("production_run_products")
