"""cantidades directas en produccion: quitar unidad-por-gramo

Revision ID: b3c4d5e6f7a8
Revises: d0e1f2a3b4c5
Create Date: 2026-08-13 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "b3c4d5e6f7a8"
down_revision = "d0e1f2a3b4c5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("production_process_materials", "quantity_per_unit")
    op.drop_column("production_process_materials", "unit_code")

    op.drop_column("production_process_stage_ingredients", "quantity")
    op.drop_column("production_process_stage_ingredients", "unit_code")

    op.drop_column("production_runs", "raw_material_quantity_per_unit")

    op.alter_column(
        "assembly_recipe_items", "quantity_per_unit", new_column_name="quantity"
    )
    # Recetas aprendidas: sus numeros eran gramos-por-pieza, no totales.
    # Reinterpretarlos como total daria sugerencias sin sentido; se reinician.
    op.execute("DELETE FROM assembly_recipe_items")
    op.execute("DELETE FROM assembly_recipes")

    op.create_table(
        "production_run_stage_ingredients",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "run_stage_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("production_run_stages.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("inventory_item_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("quantity", sa.Numeric(14, 4), nullable=False),
        sa.Column("unit_code", sa.String(20), nullable=False),
        sa.Column(
            "reserved_quantity", sa.Numeric(14, 4), nullable=False, server_default="0"
        ),
    )
    op.create_index(
        "ix_production_run_stage_ingredients_run_stage_id",
        "production_run_stage_ingredients",
        ["run_stage_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_production_run_stage_ingredients_run_stage_id",
        table_name="production_run_stage_ingredients",
    )
    op.drop_table("production_run_stage_ingredients")

    op.alter_column(
        "assembly_recipe_items", "quantity", new_column_name="quantity_per_unit"
    )

    op.add_column(
        "production_runs",
        sa.Column("raw_material_quantity_per_unit", sa.Numeric(14, 4), nullable=False, server_default="1"),
    )
    op.alter_column("production_runs", "raw_material_quantity_per_unit", server_default=None)

    op.add_column(
        "production_process_stage_ingredients",
        sa.Column("quantity", sa.Numeric(14, 4), nullable=False, server_default="1"),
    )
    op.alter_column("production_process_stage_ingredients", "quantity", server_default=None)
    op.add_column(
        "production_process_stage_ingredients",
        sa.Column("unit_code", sa.String(20), nullable=False, server_default="g"),
    )
    op.alter_column("production_process_stage_ingredients", "unit_code", server_default=None)

    op.add_column(
        "production_process_materials",
        sa.Column("quantity_per_unit", sa.Numeric(14, 4), nullable=False, server_default="1"),
    )
    op.alter_column("production_process_materials", "quantity_per_unit", server_default=None)
    op.add_column(
        "production_process_materials",
        sa.Column("unit_code", sa.String(20), nullable=False, server_default="g"),
    )
    op.alter_column("production_process_materials", "unit_code", server_default=None)
