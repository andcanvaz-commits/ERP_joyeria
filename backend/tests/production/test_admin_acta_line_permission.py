"""Solo admin puede pegarle al boton de agregar linea de acta enlazada a
inventario (o libre) -- mismo patron que
backend/tests/maintenance/test_admin_only_permissions.py pero para el
permiso propio de produccion."""
from uuid import uuid4

import pytest
from fastapi import HTTPException

from backend.modules.auth.dependencies import CurrentUser
from backend.modules.production.router import ensure_permission

NON_ADMIN_ROLES = ["Producción/Inventario", "unknown"]


def _user(role: str) -> CurrentUser:
    return CurrentUser(id=uuid4(), username="tester", role=role, permissions=frozenset())


@pytest.mark.parametrize("role", NON_ADMIN_ROLES)
def test_admin_stock_permission_rejects_non_admin(role):
    with pytest.raises(HTTPException) as exc_info:
        ensure_permission(_user(role), "production.acta-lines.admin-stock")
    assert exc_info.value.status_code == 403


@pytest.mark.parametrize("role", ["admin", "Admin"])
def test_admin_stock_permission_allows_admin(role):
    ensure_permission(_user(role), "production.acta-lines.admin-stock")  # no debe levantar excepcion
