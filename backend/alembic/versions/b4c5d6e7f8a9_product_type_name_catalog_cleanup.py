"""Nombre en product_types y limpieza de modelos-producto del catalogo.

- product_types.name: nombre libre del producto (como description en inventario).
  Varios productos pueden compartir product_code; unicidad pasa a (product_code, name).
- catalog_segments: desactiva segmentos MODEL que son nombres de producto heredados
  del Excel (no referenciados por inventario ni product_types). Se conservan las
  categorias genericas VARIOS/FILIGRANA.

Revision ID: b4c5d6e7f8a9
Revises: a3b4c5d6e7f8
Create Date: 2026-07-07
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b4c5d6e7f8a9"
down_revision: Union[str, None] = "a3b4c5d6e7f8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("product_types", sa.Column("name", sa.String(180), nullable=True))
    op.drop_index("ix_product_types_product_code", table_name="product_types")
    op.create_index("ix_product_types_product_code", "product_types", ["product_code"])
    op.create_index(
        "uq_product_types_code_name", "product_types", ["product_code", "name"], unique=True
    )

    op.execute(
        """
        UPDATE catalog_segments SET is_active = false
        WHERE kind = 'MODEL'
          AND is_active
          AND upper(label) NOT IN ('VARIOS', 'FILIGRANA')
          AND NOT EXISTS (
            SELECT 1 FROM inventory_items i
            WHERE i.product_code IS NOT NULL
              AND length(i.product_code) >= 7
              AND substring(i.product_code, 2, 2) = catalog_segments.parent_code
              AND substring(i.product_code, 4, 4) = catalog_segments.code
          )
          AND NOT EXISTS (
            SELECT 1 FROM product_types p
            WHERE p.category_code = catalog_segments.parent_code
              AND p.model_code = catalog_segments.code
          )
        """
    )


def downgrade() -> None:
    op.execute("UPDATE catalog_segments SET is_active = true WHERE kind = 'MODEL'")
    op.drop_index("uq_product_types_code_name", table_name="product_types")
    op.drop_index("ix_product_types_product_code", table_name="product_types")
    op.create_index("ix_product_types_product_code", "product_types", ["product_code"], unique=True)
    op.drop_column("product_types", "name")
