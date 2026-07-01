from dataclasses import dataclass
from uuid import UUID

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from backend.modules.config.settings import settings


ACCESS_COOKIE_NAME = "access_token"


@dataclass(frozen=True)
class CurrentUser:
    id: UUID
    username: str
    role: str
    permissions: frozenset[str]


DEV_PRODUCTION_PERMISSIONS = frozenset(
    {
        "production.processes.read",
        "production.processes.create",
        "production.processes.update",
        "production.processes.delete",
        "production.runs.read",
        "production.runs.create",
        "production.runs.update",
        "inventory.read",
        "inventory.items.create",
        "inventory.items.update",
        "inventory.items.delete",
        "inventory.movements.create",
    }
)


bearer_scheme = HTTPBearer(auto_error=False)


def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> CurrentUser:
    if settings.dev_auth_enabled:
        return CurrentUser(
            id=UUID(settings.dev_user_id),
            username=settings.dev_username,
            role="admin",
            permissions=DEV_PRODUCTION_PERMISSIONS,
        )
    # Prioridad: cookie HttpOnly; fallback a header Authorization (clientes no-web).
    token = request.cookies.get(ACCESS_COOKIE_NAME)
    if token is None and credentials is not None:
        token = credentials.credentials
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No autenticado.")
    try:
        from backend.modules.auth.service import AuthError, decode_access_token

        return decode_access_token(token)
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
