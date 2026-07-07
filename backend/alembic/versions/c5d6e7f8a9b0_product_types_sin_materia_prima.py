"""Tipos de producto sin materia prima ni codigo con metal.

El mantenimiento define tipo + categoria + nombre; el metal/materia prima se
decide despues, en produccion. Se eliminan product_code y raw_material_item_id;
la unicidad pasa a (category_code, model_code, name).

Revision ID: c5d6e7f8a9b0
Revises: b4c5d6e7f8a9
Create Date: 2026-07-07
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision: str = "c5d6e7f8a9b0"
down_revision: Union[str, None] = "b4c5d6e7f8a9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_index("uq_product_types_code_name", table_name="product_types")
    op.drop_index("ix_product_types_product_code", table_name="product_types")
    op.drop_column("product_types", "product_code")
    op.drop_constraint("product_types_raw_material_item_id_fkey", "product_types", type_="foreignkey")
    op.drop_column("product_types", "raw_material_item_id")
    op.create_index(
        "uq_product_types_cat_model_name",
        "product_types",
        ["category_code", "model_code", "name"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_product_types_cat_model_name", table_name="product_types")
    op.add_column("product_types", sa.Column("raw_material_item_id", UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "product_types_raw_material_item_id_fkey",
        "product_types",
        "inventory_items",
        ["raw_material_item_id"],
        ["id"],
    )
    op.add_column("product_types", sa.Column("product_code", sa.String(20), nullable=True))
    op.create_index("ix_product_types_product_code", "product_types", ["product_code"])
    op.create_index("uq_product_types_code_name", "product_types", ["product_code", "name"], unique=True)
