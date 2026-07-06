"""Consolida productos terminados: piezas -> modelos.

Agrupa FINISHED_PRODUCT por (name, purity, unit_code); sobrevive la fila de
menor sku, acumula current_stock/total_weight, promedia average_cost ponderado
y re-apunta inventory_movements. Downgrade NO restaura las piezas originales
(consolidacion irreversible por diseno; ver spec 2026-07-06).

Revision ID: d0e1f2a3b4c5
Revises: c9d0e1f2a3b4
Create Date: 2026-07-06
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d0e1f2a3b4c5"
down_revision: Union[str, None] = "c9d0e1f2a3b4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Normaliza material_type segun la ley (coincide con materias primas reales).
    op.execute(
        "UPDATE inventory_items SET material_type = 'PLATA MIL' "
        "WHERE item_type = 'FINISHED_PRODUCT' AND purity = '99.99'"
    )
    op.execute(
        "UPDATE inventory_items SET material_type = 'PLATA LIGADA' "
        "WHERE item_type = 'FINISHED_PRODUCT' AND purity = '99.25'"
    )

    # 2. Grupos: sobrevive la fila de menor sku por (name, purity, unit_code).
    op.execute(
        """
        CREATE TEMPORARY TABLE fp_groups ON COMMIT DROP AS
        SELECT
            (array_agg(id ORDER BY sku))[1] AS survivor_id,
            array_agg(id) AS all_ids,
            SUM(current_stock) AS stock_sum,
            SUM(COALESCE(total_weight, 0)) AS weight_sum,
            CASE WHEN SUM(current_stock) > 0
                 THEN SUM(current_stock * average_cost) / SUM(current_stock)
                 ELSE 0 END AS avg_cost
        FROM inventory_items
        WHERE item_type = 'FINISHED_PRODUCT'
        GROUP BY name, COALESCE(purity, ''), unit_code
        """
    )

    # 3. Re-apunta movimientos de las piezas absorbidas al modelo sobreviviente.
    op.execute(
        """
        UPDATE inventory_movements m
        SET item_id = g.survivor_id
        FROM fp_groups g
        WHERE m.item_id = ANY(g.all_ids) AND m.item_id <> g.survivor_id
        """
    )

    # 4. Acumula stock, peso y costo promedio ponderado en el sobreviviente.
    op.execute(
        """
        UPDATE inventory_items i
        SET current_stock = g.stock_sum,
            total_weight = g.weight_sum,
            average_cost = g.avg_cost
        FROM fp_groups g
        WHERE i.id = g.survivor_id
        """
    )

    # 5. Borra las piezas absorbidas.
    op.execute(
        """
        DELETE FROM inventory_items i
        USING fp_groups g
        WHERE i.id = ANY(g.all_ids) AND i.id <> g.survivor_id
        """
    )


def downgrade() -> None:
    # Irreversible: las piezas originales ya no existen tras consolidar.
    pass
