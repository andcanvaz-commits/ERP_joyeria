"""recetas de ensamble por clave de modelo, no por tipo de producto

Revision ID: a5b6c7d8e9f0
Revises: f4a5b6c7d8e9
Create Date: 2026-07-23
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "a5b6c7d8e9f0"
down_revision = "f4a5b6c7d8e9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Tabla vacia en produccion: se puede reconstruir la clave sin migrar datos.
    op.execute("DELETE FROM assembly_recipe_items")
    op.execute("DELETE FROM assembly_recipes")
    op.drop_column("assembly_recipes", "product_type_id")
    op.add_column("assembly_recipes", sa.Column("model_key", sa.String(6), nullable=False, unique=True))


def downgrade() -> None:
    op.execute("DELETE FROM assembly_recipe_items")
    op.execute("DELETE FROM assembly_recipes")
    op.drop_column("assembly_recipes", "model_key")
    op.add_column(
        "assembly_recipes",
        sa.Column(
            "product_type_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("product_types.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
    )
