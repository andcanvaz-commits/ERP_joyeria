"""catalog, units y product_types no llamaban ensure_permission: cualquier
usuario logueado (no solo admin) podia crear/borrar materiales, categorias,
modelos, unidades y tipos de producto. Estos tests cubren el fix: solo
admin puede escribir; los demas roles (y el catalogo sigue siendo lectura
abierta para todos, eso no se toca aqui)."""
from uuid import uuid4

import pytest
from fastapi import HTTPException

from backend.modules.auth.dependencies import CurrentUser
from backend.modules.catalog.router import _ensure_admin as catalog_ensure_admin
from backend.modules.product_types.router import _ensure_admin as product_types_ensure_admin
from backend.modules.units.router import _ensure_admin as units_ensure_admin

NON_ADMIN_ROLES = ["Jefe de inventario", "Jefe de producción", "unknown"]


def _user(role: str) -> CurrentUser:
    return CurrentUser(id=uuid4(), username="tester", role=role, permissions=frozenset())


@pytest.mark.parametrize("ensure_admin", [catalog_ensure_admin, units_ensure_admin, product_types_ensure_admin])
@pytest.mark.parametrize("role", NON_ADMIN_ROLES)
def test_ensure_admin_rejects_non_admin_roles(ensure_admin, role):
    with pytest.raises(HTTPException) as exc_info:
        ensure_admin(_user(role))
    assert exc_info.value.status_code == 403


@pytest.mark.parametrize("ensure_admin", [catalog_ensure_admin, units_ensure_admin, product_types_ensure_admin])
@pytest.mark.parametrize("role", ["admin", "Admin"])
def test_ensure_admin_allows_admin_roles(ensure_admin, role):
    ensure_admin(_user(role))  # no debe levantar excepcion
