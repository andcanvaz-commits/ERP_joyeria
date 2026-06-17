from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import secrets
from uuid import UUID

import jwt
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.modules.auth.dependencies import CurrentUser
from backend.modules.auth.models import AuthUser
from backend.modules.config.settings import settings


OWNER_PERMISSIONS = [
    "production.read",
    "production.create",
    "production.start",
    "production.pause",
    "production.resume",
    "production.finish",
    "production.cancel",
    "production.stages.start",
    "production.stages.finish",
    "production.process_templates.read",
    "production.process_templates.create",
]

ADMIN_PERMISSIONS = [
    "production.read",
    "production.process_templates.read",
]


class AuthError(ValueError):
    pass


def hash_password(password: str, salt: str | None = None) -> str:
    password_salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        password_salt.encode("utf-8"),
        210_000,
    ).hex()
    return f"pbkdf2_sha256${password_salt}${digest}"


def verify_password(password: str, password_hash: str) -> bool:
    try:
        algorithm, salt, expected_digest = password_hash.split("$", 2)
    except ValueError:
        return False
    if algorithm != "pbkdf2_sha256":
        return False
    candidate = hash_password(password, salt).split("$", 2)[2]
    return hmac.compare_digest(candidate, expected_digest)


def create_access_token(user: AuthUser) -> str:
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    payload = {
        "sub": str(user.id),
        "username": user.username,
        "role": user.role,
        "permissions": user.permissions,
        "type": "access",
        "exp": expires_at,
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm="HS256")


def decode_access_token(token: str) -> CurrentUser:
    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise AuthError("Token invalido o expirado.") from exc
    if payload.get("type") != "access":
        raise AuthError("Token invalido.")
    permissions = payload.get("permissions")
    if not isinstance(permissions, list):
        raise AuthError("Token sin permisos validos.")
    return CurrentUser(
        id=UUID(str(payload["sub"])),
        username=str(payload["username"]),
        role=str(payload.get("role", "")),
        permissions=frozenset(str(permission) for permission in permissions),
    )


class AuthService:
    def __init__(self, session: Session) -> None:
        self.session = session

    def authenticate(self, username: str, password: str) -> AuthUser:
        user = self.session.execute(select(AuthUser).where(AuthUser.username == username)).scalar_one_or_none()
        if user is None or not user.is_active or not verify_password(password, user.password_hash):
            raise AuthError("Credenciales invalidas.")
        return user

    def get_user(self, user_id: UUID) -> AuthUser | None:
        return self.session.get(AuthUser, user_id)


def seed_default_users(session: Session) -> None:
    seed_user(
        session,
        username=settings.seed_owner_username,
        password=settings.seed_owner_password,
        role="owner",
        permissions=OWNER_PERMISSIONS,
    )
    seed_user(
        session,
        username=settings.seed_admin_username,
        password=settings.seed_admin_password,
        role="admin",
        permissions=ADMIN_PERMISSIONS,
    )
    session.commit()


def seed_user(session: Session, *, username: str, password: str, role: str, permissions: list[str]) -> None:
    user = session.execute(select(AuthUser).where(AuthUser.username == username)).scalar_one_or_none()
    if user is None:
        session.add(
            AuthUser(
                username=username,
                password_hash=hash_password(password),
                role=role,
                permissions=permissions,
                is_active=True,
            )
        )
        return

    user.role = role
    user.permissions = permissions
    user.is_active = True
    user.updated_at = datetime.utcnow()
