from dataclasses import dataclass
from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from backend.modules.config.settings import settings


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


def get_current_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme)) -> CurrentUser:
    if settings.dev_auth_enabled:
        return CurrentUser(
            id=UUID(settings.dev_user_id),
            username=settings.dev_username,
            role="admin",
            permissions=DEV_PRODUCTION_PERMISSIONS,
        )
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No autenticado.")
    try:
        from backend.modules.auth.service import AuthError, decode_access_token

        return decode_access_token(credentials.credentials)
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
