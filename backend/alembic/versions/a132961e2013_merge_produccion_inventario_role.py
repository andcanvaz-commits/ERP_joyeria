"""Fusiona los roles "Jefe de produccion" y "Jefe de inventario" en un solo
rol "Producción/Inventario" (docs/cambios-sistema-produccion.md seccion 2).

ROLE_PERMISSIONS en backend/modules/auth/service.py ya no tiene entradas para
los roles viejos -- sin esta migracion, cualquier usuario con esos roles
perderia todos sus permisos en su proximo login (_permissions_for_role
devuelve [] para una clave que no existe).

Revision ID: a132961e2013
Revises: f1a2b3c4d5e6
Create Date: 2026-08-18
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a132961e2013"
down_revision: Union[str, None] = "f1a2b3c4d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

OLD_ROLES = ("Jefe de producción", "Jefe de inventario")
NEW_ROLE = "Producción/Inventario"


def upgrade() -> None:
    connection = op.get_bind()
    connection.execute(
        sa.text("UPDATE auth_users SET role = :new_role WHERE role IN :old_roles").bindparams(
            sa.bindparam("old_roles", expanding=True)
        ),
        {"new_role": NEW_ROLE, "old_roles": list(OLD_ROLES)},
    )


def downgrade() -> None:
    # Irreversible por diseno: no hay forma de saber si un usuario fusionado
    # era originalmente "Jefe de produccion" o "Jefe de inventario".
    pass
