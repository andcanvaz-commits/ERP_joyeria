"""Anillos de filigrana: grupo ANILLOS con modelo FILIGRANA.

Crea el modelo FILIGRANA bajo la categoria 02 ANILLOS, recodifica las
piezas del grupo 'ANILLOS DE FILIGRANA - VARIOS' (2020002-*) a ese modelo
y renombra el grupo a 'ANILLOS'. Downgrade no revierte (backup pg_dump).

Revision ID: f2a3b4c5d6e7
Revises: e1f2a3b4c5d6
Create Date: 2026-07-06
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f2a3b4c5d6e7"
down_revision: Union[str, None] = "e1f2a3b4c5d6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Modelo FILIGRANA bajo 02 ANILLOS (siguiente codigo libre; idempotente).
    op.execute(
        """
        INSERT INTO catalog_segments (id, kind, code, label, parent_code, is_active, created_at)
        SELECT gen_random_uuid(),
               'MODEL',
               LPAD((COALESCE(MAX(code::int), 0) + 1)::text, 4, '0'),
               'FILIGRANA',
               '02',
               true,
               now()
        FROM catalog_segments
        WHERE kind = 'MODEL' AND parent_code = '02' AND code ~ '^[0-9]+$'
          AND NOT EXISTS (
              SELECT 1 FROM catalog_segments
              WHERE kind = 'MODEL' AND parent_code = '02' AND label = 'FILIGRANA'
          )
        """
    )

    # 2. Recodifica las piezas del grupo al modelo FILIGRANA conservando su secuencia.
    op.execute(
        """
        WITH filigrana AS (
            SELECT '2' || parent_code || code AS pcode
            FROM catalog_segments
            WHERE kind = 'MODEL' AND parent_code = '02' AND label = 'FILIGRANA'
        )
        UPDATE inventory_items i
        SET product_code = f.pcode,
            sku = f.pcode || SUBSTRING(i.sku FROM 8)
        FROM filigrana f
        WHERE i.item_type = 'FINISHED_PRODUCT'
          AND i.name = 'ANILLOS DE FILIGRANA - VARIOS'
          AND i.sku ~ '^[0-9]{7}-[0-9]{4}$'
        """
    )

    # 3. Renombra el grupo.
    op.execute(
        """
        UPDATE inventory_items
        SET name = 'ANILLOS'
        WHERE item_type = 'FINISHED_PRODUCT' AND name = 'ANILLOS DE FILIGRANA - VARIOS'
        """
    )


def downgrade() -> None:
    # Irreversible sin el backup pg_dump previo.
    pass
