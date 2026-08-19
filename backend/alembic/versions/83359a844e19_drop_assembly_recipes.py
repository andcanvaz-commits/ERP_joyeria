"""Elimina el sistema de recetas y ensamblaje por completo
(docs/cambios-sistema-produccion.md seccion 6, confirmado: se borra codigo,
rutas, UI, tablas de BD y datos historicos, sin conservar nada).

No incluye downgrade con datos: recrear el esquema vacio no devuelve las
recetas ni las solicitudes de complemento borradas.

Revision ID: 83359a844e19
Revises: a132961e2013
Create Date: 2026-08-18
"""
from typing import Sequence, Union

from alembic import op


revision: str = "83359a844e19"
down_revision: Union[str, None] = "a132961e2013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_table("assembly_recipe_items")
    op.drop_table("production_run_assembly_items")
    op.drop_table("production_complement_requests")
    op.drop_table("assembly_recipes")
    op.drop_column("production_runs", "assembly_mode")
    op.drop_column("production_runs", "assembly_pending")


def downgrade() -> None:
    # Irreversible por diseno, igual que la migracion anterior.
    pass
