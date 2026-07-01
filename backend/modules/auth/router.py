from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from backend.modules.auth.dependencies import ACCESS_COOKIE_NAME, CurrentUser, get_current_user
from backend.modules.auth.schemas import (
    AuthUserCreate,
    AuthUserCredentialRead,
    AuthUserRead,
    AuthUserUpdate,
    ChangePasswordRequest,
    LoginRequest,
    TokenPair,
)
from backend.modules.auth.service import AuthError, AuthService, create_access_token
from backend.modules.config.settings import settings
from backend.modules.database.session import SessionLocal
from backend.modules.shared.rate_limit import SlidingWindowRateLimiter, get_client_ip


def _set_access_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=ACCESS_COOKIE_NAME,
        value=token,
        max_age=settings.access_token_expire_minutes * 60,
        httponly=True,
        secure=settings.is_production,
        samesite="lax",
        path="/",
    )


def _clear_access_cookie(response: Response) -> None:
    response.delete_cookie(key=ACCESS_COOKIE_NAME, path="/")


router = APIRouter()

# Limite por IP: probar distintos usuarios/mayusculas desde la misma IP cuenta
# en el mismo bucket, asi que variar el nombre no evade el limite.
_login_ip_limiter = SlidingWindowRateLimiter(
    settings.login_rate_limit_max,
    settings.login_rate_limit_window_seconds,
)
# Limite por username: frena intentos distribuidos contra una sola cuenta.
_login_user_limiter = SlidingWindowRateLimiter(
    settings.login_rate_limit_max * 3,
    settings.login_rate_limit_window_seconds,
)


def _enforce_login_rate_limit(request: Request, username: str) -> None:
    ip = get_client_ip(request)
    allowed_ip, retry_ip = _login_ip_limiter.check(f"ip:{ip}")
    allowed_user, retry_user = _login_user_limiter.check(f"user:{username.strip().lower()}")
    if not (allowed_ip and allowed_user):
        retry_after = max(retry_ip, retry_user)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Demasiados intentos de inicio de sesion. Intenta mas tarde.",
            headers={"Retry-After": str(retry_after)},
        )


def _clear_login_rate_limit(request: Request, username: str) -> None:
    _login_ip_limiter.reset(f"ip:{get_client_ip(request)}")
    _login_user_limiter.reset(f"user:{username.strip().lower()}")


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
def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    service: AuthService = Depends(get_auth_service),
) -> TokenPair:
    _enforce_login_rate_limit(request, payload.username)
    try:
        user = service.authenticate(payload.username, payload.password)
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    _clear_login_rate_limit(request, payload.username)
    access_token = create_access_token(user)
    _set_access_cookie(response, access_token)
    # El token va en cookie HttpOnly; el cuerpo se mantiene por compatibilidad
    # con clientes no-web. El frontend no lo almacena.
    return TokenPair(access_token=access_token, refresh_token=access_token)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response) -> Response:
    _clear_access_cookie(response)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    payload: ChangePasswordRequest,
    current_user: CurrentUser = Depends(get_current_user),
    service: AuthService = Depends(get_auth_service),
) -> Response:
    try:
        service.change_password(current_user.id, payload.current_password, payload.new_password)
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me", response_model=AuthUserRead)
def me(
    current_user: CurrentUser = Depends(get_current_user),
    service: AuthService = Depends(get_auth_service),
) -> AuthUserRead:
    user = service.get_user(current_user.id)
    if user is not None:
        return read_user(user)
    # Fallback (p.ej. auth de desarrollo sin registro en BD).
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
        must_change_password=user.must_change_password,
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
