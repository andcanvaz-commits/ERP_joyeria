"""production_runs.raw_material_item_id nullable + limpieza del item
"Plata" fantasma creado para el import de ordenes historicas

Las ordenes historicas (production_runs con event_lines) no deben referenciar
ninguna materia prima real: nunca hubo un consumo de inventario real detras
de esas actas de papel. Un item RAW_MATERIAL llamado "Plata" se habia creado
fuera de banda (nunca via migracion/script) solo para satisfacer el NOT NULL
de raw_material_item_id, y por no filtrar archivados quedaba seleccionable
en el picker de materiales de una orden en vivo nueva.

Revision ID: 767e2aa9124c
Revises: b1c2d3e4f5a6
Create Date: 2026-08-05
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "767e2aa9124c"
down_revision: Union[str, None] = "b1c2d3e4f5a6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        "production_runs",
        "raw_material_item_id",
        existing_type=sa.dialects.postgresql.UUID(as_uuid=True),
        nullable=True,
    )
    # Desvincula toda orden historica (identificada por tener event_lines)
    # de cualquier item de inventario — nunca debieron depender de uno.
    op.execute(
        """
        UPDATE production_runs
        SET raw_material_item_id = NULL
        WHERE id IN (SELECT DISTINCT run_id FROM production_run_event_lines)
        """
    )
    # Borra el item fantasma "Plata" (RAW_MATERIAL, archivado, 0 stock, 0
    # movimientos) si quedo huerfano tras el UPDATE de arriba. Nombre exacto
    # para no tocar las 3 variantes reales (PLATA MIL/LIGADA/VARIOS).
    op.execute(
        """
        DELETE FROM inventory_items
        WHERE item_type = 'RAW_MATERIAL'
          AND name = 'Plata'
          AND id NOT IN (SELECT DISTINCT raw_material_item_id FROM production_runs WHERE raw_material_item_id IS NOT NULL)
          AND id NOT IN (SELECT DISTINCT item_id FROM inventory_movements)
        """
    )


def downgrade() -> None:
    # Irreversible: el item "Plata" borrado y los raw_material_item_id
    # anulados no se pueden reconstruir con datos reales. Revertir la
    # columna a NOT NULL aqui fallaria contra las filas ya anuladas.
    raise NotImplementedError(
        "Esta migracion no es reversible: borro el item 'Plata' fantasma y "
        "anulo raw_material_item_id en las ordenes historicas. No hay datos "
        "para reconstruir ninguno de los dos."
    )
