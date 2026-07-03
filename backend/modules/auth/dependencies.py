from dataclasses import dataclass
from uuid import UUID

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer


ACCESS_COOKIE_NAME = "access_token"


@dataclass(frozen=True)
class CurrentUser:
    id: UUID
    username: str
    role: str
    permissions: frozenset[str]


bearer_scheme = HTTPBearer(auto_error=False)


def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> CurrentUser:
    # No hay bypass: toda peticion se autentica con un JWT valido.
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
