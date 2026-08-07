"""reserva de stock al destinar parcial (materia prima + complementos)

Inventario puede destinar stock a una corrida ESPERANDO_MATERIAL y elegir
NO arrancar produccion todavia: el stock queda reservado para esa orden
puntual -- no se consume (no hay movimiento) pero deja de estar disponible
para otras ordenes.

Ambas columnas son ADITIVAS y no destructivas: server_default '0' significa
"nada reservado", que es exactamente el comportamiento previo. Las filas
existentes no cambian de valor ni de significado.

Revision ID: d0e1f2a3b4c5
Revises: 767e2aa9124c
Create Date: 2026-08-06
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "d0e1f2a3b4c5"
down_revision: Union[str, None] = "767e2aa9124c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "production_runs",
        sa.Column(
            "reserved_material_quantity",
            sa.Numeric(14, 4),
            nullable=False,
            server_default="0",
        ),
    )
    op.add_column(
        "production_complement_requests",
        sa.Column(
            "reserved_quantity",
            sa.Numeric(14, 4),
            nullable=False,
            server_default="0",
        ),
    )


def downgrade() -> None:
    op.drop_column("production_complement_requests", "reserved_quantity")
    op.drop_column("production_runs", "reserved_material_quantity")
