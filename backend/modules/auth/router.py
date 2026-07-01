from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from backend.modules.auth.dependencies import CurrentUser, get_current_user
from backend.modules.auth.schemas import AuthUserCreate, AuthUserCredentialRead, AuthUserRead, AuthUserUpdate, LoginRequest, TokenPair
from backend.modules.auth.service import AuthError, AuthService, create_access_token
from backend.modules.database.session import SessionLocal


router = APIRouter()


def get_auth_service():
    session = SessionLocal()
    try:
        yield AuthService(session)
        session.commit()
    except Exception:
        session.rollback()
        raise
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
        first_name="",
        last_name="",
        email="",
        role=current_user.role,
        permissions=sorted(current_user.permissions),
        is_active=True,
    )


def ensure_admin(current_user: CurrentUser) -> None:
    if current_user.role not in {"admin", "Admin"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permiso denegado.")


def read_user(user) -> AuthUserRead:
    return AuthUserRead(
        id=str(user.id),
        username=user.username,
        first_name=user.first_name or "",
        last_name=user.last_name or "",
        email=user.email or "",
        role=user.role,
        employee_code=user.employee_code,
        permissions=sorted(user.permissions),
        is_active=user.is_active,
    )


@router.get("/users", response_model=list[AuthUserRead])
def list_users(
    current_user: CurrentUser = Depends(get_current_user),
    service: AuthService = Depends(get_auth_service),
) -> list[AuthUserRead]:
    ensure_admin(current_user)
    return [read_user(user) for user in service.list_users()]


@router.post("/users", response_model=AuthUserCredentialRead, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: AuthUserCreate,
    current_user: CurrentUser = Depends(get_current_user),
    service: AuthService = Depends(get_auth_service),
) -> AuthUserCredentialRead:
    ensure_admin(current_user)
    try:
        user, temporary_password = service.create_user(
            first_name=payload.first_name,
            last_name=payload.last_name,
            role=payload.role,
        )
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return AuthUserCredentialRead(user=read_user(user), temporary_password=temporary_password)


@router.put("/users/{user_id}", response_model=AuthUserRead)
def update_user(
    user_id: UUID,
    payload: AuthUserUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    service: AuthService = Depends(get_auth_service),
) -> AuthUserRead:
    ensure_admin(current_user)
    try:
        user = service.update_user(
            user_id,
            first_name=payload.first_name,
            last_name=payload.last_name,
            role=payload.role,
        )
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return read_user(user)


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    service: AuthService = Depends(get_auth_service),
) -> None:
    ensure_admin(current_user)
    try:
        service.delete_user(user_id)
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post("/users/{user_id}/deactivate", response_model=AuthUserRead)
def deactivate_user(
    user_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    service: AuthService = Depends(get_auth_service),
) -> AuthUserRead:
    ensure_admin(current_user)
    if user_id == current_user.id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="No puedes desactivar tu propia sesion.")
    try:
        user = service.deactivate_user(user_id)
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return read_user(user)


@router.post("/users/{user_id}/activate", response_model=AuthUserRead)
def activate_user(
    user_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    service: AuthService = Depends(get_auth_service),
) -> AuthUserRead:
    ensure_admin(current_user)
    try:
        user = service.activate_user(user_id)
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return read_user(user)


@router.post("/users/{user_id}/reset-password", response_model=AuthUserCredentialRead)
def reset_user_password(
    user_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    service: AuthService = Depends(get_auth_service),
) -> AuthUserCredentialRead:
    ensure_admin(current_user)
    try:
        user, temporary_password = service.reset_user_password(user_id)
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return AuthUserCredentialRead(user=read_user(user), temporary_password=temporary_password)
