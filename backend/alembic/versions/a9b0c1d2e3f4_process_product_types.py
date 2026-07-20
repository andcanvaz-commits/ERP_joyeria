"""production_process_product_types: tipos de producto que un proceso puede producir

Revision ID: a9b0c1d2e3f4
Revises: f8a9b0c1d2e3
Create Date: 2026-07-20
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


# revision identifiers, used by Alembic.
revision: str = "a9b0c1d2e3f4"
down_revision: Union[str, None] = "f8a9b0c1d2e3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(table: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return table in inspector.get_table_names()


def upgrade() -> None:
    if not _has_table("production_process_product_types"):
        op.create_table(
            "production_process_product_types",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column(
                "process_id",
                UUID(as_uuid=True),
                sa.ForeignKey("production_processes.id", ondelete="CASCADE"),
                nullable=False,
                index=True,
            ),
            sa.Column(
                "product_type_id",
                UUID(as_uuid=True),
                sa.ForeignKey("product_types.id", ondelete="CASCADE"),
                nullable=False,
                index=True,
            ),
            sa.UniqueConstraint("process_id", "product_type_id", name="uq_process_product_type"),
        )


def downgrade() -> None:
    if _has_table("production_process_product_types"):
        op.drop_table("production_process_product_types")
