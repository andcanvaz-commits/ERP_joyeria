"""receta de ensamble por material y modelo (codigo completo de 7 digitos)

Revision ID: b6c7d8e9f0a1
Revises: a5b6c7d8e9f0
Create Date: 2026-07-23
"""
import sqlalchemy as sa
from alembic import op

revision = "b6c7d8e9f0a1"
down_revision = "a5b6c7d8e9f0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Tabla vacia en produccion: se puede reconstruir la clave sin migrar datos.
    # Clave = material(1) + categoria(2) + modelo(4): la receta ya no se
    # comparte entre materiales (oro y plata dejan de compartir receta).
    op.execute("DELETE FROM assembly_recipe_items")
    op.execute("DELETE FROM assembly_recipes")
    op.alter_column("assembly_recipes", "model_key", type_=sa.String(7))


def downgrade() -> None:
    op.execute("DELETE FROM assembly_recipe_items")
    op.execute("DELETE FROM assembly_recipes")
    op.alter_column("assembly_recipes", "model_key", type_=sa.String(6))
