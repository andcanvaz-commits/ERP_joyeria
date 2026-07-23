"""ensamble: recetas, tipos de complemento y modo de orden

Revision ID: f4a5b6c7d8e9
Revises: e3f4a5b6c7d8
Create Date: 2026-07-23
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "f4a5b6c7d8e9"
down_revision = "e3f4a5b6c7d8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "complement_types",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(120), nullable=False, unique=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.add_column(
        "inventory_items",
        sa.Column(
            "complement_type_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("complement_types.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_table(
        "assembly_recipes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "product_type_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("product_types.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_table(
        "assembly_recipe_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "recipe_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("assembly_recipes.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("complement_item_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("quantity_per_unit", sa.Numeric(14, 4), nullable=False),
    )
    op.create_table(
        "production_run_assembly_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "run_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("production_runs.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("complement_item_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("quantity", sa.Numeric(14, 4), nullable=False),
    )
    op.add_column(
        "production_runs",
        sa.Column("assembly_mode", sa.String(20), nullable=False, server_default="ASIGNAR"),
    )
    op.add_column(
        "production_runs",
        sa.Column("assembly_pending", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.alter_column("production_run_products", "product_type_id", nullable=True)
    op.add_column(
        "production_run_products",
        sa.Column("target_item_id", postgresql.UUID(as_uuid=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("production_run_products", "target_item_id")
    op.alter_column("production_run_products", "product_type_id", nullable=False)
    op.drop_column("production_runs", "assembly_pending")
    op.drop_column("production_runs", "assembly_mode")
    op.drop_table("production_run_assembly_items")
    op.drop_table("assembly_recipe_items")
    op.drop_table("assembly_recipes")
    op.drop_column("inventory_items", "complement_type_id")
    op.drop_table("complement_types")
