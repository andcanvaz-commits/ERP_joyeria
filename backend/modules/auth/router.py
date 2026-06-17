from fastapi import APIRouter, Depends, HTTPException, status

from backend.modules.auth.dependencies import CurrentUser, get_current_user
from backend.modules.auth.schemas import AuthUserRead, LoginRequest, TokenPair
from backend.modules.auth.service import AuthError, AuthService, create_access_token
from backend.modules.database.session import SessionLocal


router = APIRouter()


def get_auth_service():
    session = SessionLocal()
    try:
        yield AuthService(session)
    finally:
        session.close()


@router.get("/health")
def auth_health() -> dict[str, str]:
    return {"module": "auth", "status": "ready"}


@router.post("/login", response_model=TokenPair)
def login(payload: LoginRequest, service: AuthService = Depends(get_auth_service)) -> TokenPair:
    try:
        user = service.authenticate(payload.username, payload.password)
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    access_token = create_access_token(user)
    return TokenPair(access_token=access_token, refresh_token=access_token)


@router.get("/me", response_model=AuthUserRead)
def me(current_user: CurrentUser = Depends(get_current_user)) -> AuthUserRead:
    return AuthUserRead(
        id=str(current_user.id),
        username=current_user.username,
        role=current_user.role,
        permissions=sorted(current_user.permissions),
    )
