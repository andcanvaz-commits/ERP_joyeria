"""Codifica productos terminados con la logica de catalogo.

material(1) + categoria(2) + modelo(4): product_code = p.ej. 2010002 y
sku = 2010002-0001. Crea categorias 30 DIJES / 31 JUEGOS y un modelo
'VARIOS' por categoria usada. Solo toca piezas con sku 'PT-%'.
Downgrade no restaura los SKU PT (camino de vuelta: backup pg_dump).

Revision ID: e1f2a3b4c5d6
Revises: c9d0e1f2a3b4
Create Date: 2026-07-06
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e1f2a3b4c5d6"
down_revision: Union[str, None] = "c9d0e1f2a3b4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# name de las piezas -> codigo de categoria del catalogo
GROUP_TO_CATEGORY = {
    "ANILLOS DE FILIGRANA - VARIOS": "02",
    "ARETES": "01",
    "CADENAS": "06",
    "COLLARES": "29",
    "DENARIOS": "11",
    "DIJES": "30",
    "JUEGOS": "31",
    "MEDALLAS": "14",
    "MONEDAS": "28",
    "PULSERAS VARIAS": "20",
    "ROSARIOS": "21",
}
NEW_CATEGORIES = [("30", "DIJES"), ("31", "JUEGOS")]


def upgrade() -> None:
    # 1. Categorias faltantes.
    for code, label in NEW_CATEGORIES:
        op.execute(
            f"""
            INSERT INTO catalog_segments (id, kind, code, label, parent_code, is_active, created_at)
            SELECT gen_random_uuid(), 'CATEGORY', '{code}', '{label}', NULL, true, now()
            WHERE NOT EXISTS (
                SELECT 1 FROM catalog_segments WHERE kind = 'CATEGORY' AND code = '{code}' AND parent_code IS NULL
            )
            """
        )

    # 2. Modelo VARIOS por categoria usada (siguiente codigo libre; idempotente).
    categories = sorted(set(GROUP_TO_CATEGORY.values()))
    cats_sql = ", ".join(f"'{c}'" for c in categories)
    op.execute(
        f"""
        DO $$
        DECLARE cat text;
        BEGIN
            FOREACH cat IN ARRAY ARRAY[{cats_sql}] LOOP
                IF NOT EXISTS (
                    SELECT 1 FROM catalog_segments
                    WHERE kind = 'MODEL' AND parent_code = cat AND label = 'VARIOS'
                ) THEN
                    INSERT INTO catalog_segments (id, kind, code, label, parent_code, is_active, created_at)
                    SELECT gen_random_uuid(),
                           'MODEL',
                           LPAD((COALESCE(MAX(code::int), 0) + 1)::text, 4, '0'),
                           'VARIOS',
                           cat,
                           true,
                           now()
                    FROM catalog_segments
                    WHERE kind = 'MODEL' AND parent_code = cat AND code ~ '^[0-9]+$';
                END IF;
            END LOOP;
        END $$;
        """
    )

    # 3. Recodificar piezas PT-%: product_code y sku con secuencia por grupo.
    mapping_sql = ", ".join(f"('{name}', '{cat}')" for name, cat in GROUP_TO_CATEGORY.items())
    op.execute(
        f"""
        WITH mapping(group_name, cat) AS (VALUES {mapping_sql}),
        varios AS (
            SELECT parent_code AS cat, code AS model_code
            FROM catalog_segments
            WHERE kind = 'MODEL' AND label = 'VARIOS'
        ),
        numbered AS (
            SELECT i.id,
                   '2' || m.cat || v.model_code AS pcode,
                   ROW_NUMBER() OVER (PARTITION BY i.name ORDER BY i.sku) AS seq
            FROM inventory_items i
            JOIN mapping m ON m.group_name = i.name
            JOIN varios v ON v.cat = m.cat
            WHERE i.item_type = 'FINISHED_PRODUCT' AND i.sku LIKE 'PT-%'
        )
        UPDATE inventory_items i
        SET product_code = n.pcode,
            sku = n.pcode || '-' || LPAD(n.seq::text, 4, '0')
        FROM numbered n
        WHERE i.id = n.id
        """
    )


def downgrade() -> None:
    # Irreversible sin el backup: los SKU PT originales ya no existen.
    pass
