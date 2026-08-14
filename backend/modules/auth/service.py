from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import logging
import re
import secrets
import unicodedata
from uuid import UUID

import jwt
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.modules.auth.dependencies import CurrentUser
from backend.modules.auth.models import AuthUser
from backend.modules.config.settings import settings


logger = logging.getLogger(__name__)

ROLE_ADMIN = "Admin"
ROLE_PRODUCTION_MANAGER = "Jefe de producción"
ROLE_INVENTORY_MANAGER = "Jefe de inventario"
SYSTEM_ROLES = (ROLE_PRODUCTION_MANAGER, ROLE_ADMIN, ROLE_INVENTORY_MANAGER)

ADMIN_PERMISSIONS = [
    "production.processes.read",
    "production.processes.create",
    "production.processes.update",
    "production.processes.delete",
    "production.runs.read",
    "production.runs.create",
    "production.runs.update",
    "production.runs.delete",
    "inventory.read",
    "inventory.items.create",
    "inventory.items.update",
    "inventory.items.delete",
    "inventory.movements.create",
    "inventory.movements.revert",
]
PRODUCTION_MANAGER_PERMISSIONS = [
    "production.processes.read",
    "production.runs.read",
    "production.runs.create",
    "production.runs.update",
    # Cancelar/eliminar una orden es exclusivo del administrador.
    # Lectura de inventario: ver materiales y stock para planificar produccion.
    "inventory.read",
]
INVENTORY_MANAGER_PERMISSIONS = [
    "production.processes.read",
    "production.runs.read",
    "production.runs.update",
    "inventory.read",
    "inventory.items.create",
    "inventory.items.update",
    "inventory.items.delete",
    # Revertir la ultima entrada es distinto de editar/eliminar items: el jefe
    # de inventario si puede (igual que el admin); ver INVENTORY_ADMIN_ONLY.
    "inventory.movements.revert",
    "inventory.movements.create",
]

ROLE_PERMISSIONS = {
    ROLE_ADMIN: ADMIN_PERMISSIONS,
    "admin": ADMIN_PERMISSIONS,
    ROLE_PRODUCTION_MANAGER: PRODUCTION_MANAGER_PERMISSIONS,
    ROLE_INVENTORY_MANAGER: INVENTORY_MANAGER_PERMISSIONS,
}

ROLE_EMAIL_IDENTIFIERS = {
    ROLE_ADMIN: "admin",
    "admin": "admin",
    ROLE_PRODUCTION_MANAGER: "produccion",
    ROLE_INVENTORY_MANAGER: "inventario",
}


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


def generate_temporary_password() -> str:
    return secrets.token_urlsafe(9)


PASSWORD_MIN_LENGTH = 8


def validate_password_strength(password: str) -> None:
    if len(password) < PASSWORD_MIN_LENGTH:
        raise AuthError(f"La contrasena debe tener al menos {PASSWORD_MIN_LENGTH} caracteres.")
    if not any(char.isalpha() for char in password):
        raise AuthError("La contrasena debe incluir al menos una letra.")
    if not any(char.isdigit() for char in password):
        raise AuthError("La contrasena debe incluir al menos un numero.")


def role_email_identifier(role: str) -> str:
    return ROLE_EMAIL_IDENTIFIERS.get(role, "usuario")


def generate_system_email(username: str, role: str) -> str:
    normalized_username = username.strip().lower().replace(" ", ".")
    identifier = role_email_identifier(role)
    # Evita duplicar el identificador cuando el username ya lo incluye
    # (ej. username "admin" con rol admin -> admin@dominio, no admin.admin@).
    if normalized_username == identifier or normalized_username.endswith(f".{identifier}"):
        return f"{normalized_username}@{settings.system_email_domain}"
    return f"{normalized_username}.{identifier}@{settings.system_email_domain}"


def generate_username_base(first_name: str, last_name: str) -> str:
    raw_username = f"{first_name.strip()}.{last_name.strip()}".lower()
    raw_username = unicodedata.normalize("NFKD", raw_username).encode("ascii", "ignore").decode("ascii")
    username = re.sub(r"[^a-z0-9.]+", "", raw_username.replace(" ", "."))
    username = re.sub(r"\.+", ".", username).strip(".")
    return username or "usuario"


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
        identifier = username.strip()
        identifier_lower = identifier.lower()
        # Permite iniciar sesion con el username o con el correo (case-insensitive).
        statement = select(AuthUser).where(
            (AuthUser.username == identifier)
            | (func.lower(AuthUser.email) == identifier_lower)
        )
        user = self.session.execute(statement).scalar_one_or_none()
        if user is None or not user.is_active or not verify_password(password, user.password_hash):
            raise AuthError("Credenciales invalidas.")
        # Re-sincroniza permisos desde el rol para que cambios en la definicion
        # de roles apliquen a usuarios ya creados en su proximo inicio de sesion.
        expected_permissions = self._permissions_for_role(user.role)
        if sorted(user.permissions or []) != sorted(expected_permissions):
            user.permissions = list(expected_permissions)
            user.updated_at = datetime.utcnow()
            self.session.flush()
        return user

    def get_user(self, user_id: UUID) -> AuthUser | None:
        return self.session.get(AuthUser, user_id)

    def list_users(self) -> list[AuthUser]:
        statement = select(AuthUser).order_by(AuthUser.username.asc())
        return list(self.session.execute(statement).scalars().all())

    def _next_employee_code(self) -> str:
        from sqlalchemy import select

        codes = self.session.execute(select(AuthUser.employee_code)).scalars().all()
        nums = [int(code) for code in codes if code and code.isdigit()]
        nxt = (max(nums) + 1) if nums else 1
        return f"{nxt:02d}"

    def create_user(
        self,
        *,
        first_name: str,
        last_name: str,
        role: str,
    ) -> tuple[AuthUser, str]:
        self._ensure_role(role)
        username = self._generate_available_username(first_name, last_name, role)
        email = generate_system_email(username, role)

        temporary_password = generate_temporary_password()
        user = AuthUser(
            username=username,
            first_name=first_name,
            last_name=last_name,
            email=email,
            password_hash=hash_password(temporary_password),
            role=role,
            employee_code=self._next_employee_code(),
            permissions=self._permissions_for_role(role),
            is_active=True,
            must_change_password=True,
        )
        self.session.add(user)
        self.session.flush()
        return user, temporary_password

    def update_user(
        self,
        user_id: UUID,
        *,
        first_name: str,
        last_name: str,
        role: str,
    ) -> AuthUser:
        self._ensure_role(role)
        username = self._generate_available_username(first_name, last_name, role, exclude_user_id=user_id)
        email = generate_system_email(username, role)
        user = self.session.get(AuthUser, user_id)
        if user is None:
            raise AuthError("Usuario no encontrado.")

        user.username = username
        user.first_name = first_name
        user.last_name = last_name
        user.email = email
        user.role = role
        user.permissions = self._permissions_for_role(role)
        user.updated_at = datetime.utcnow()
        self.session.flush()
        return user

    def delete_user(self, user_id: UUID) -> None:
        user = self.session.get(AuthUser, user_id)
        if user is None:
            raise AuthError("Usuario no encontrado.")
        self.session.delete(user)

    def deactivate_user(self, user_id: UUID) -> AuthUser:
        user = self.session.get(AuthUser, user_id)
        if user is None:
            raise AuthError("Usuario no encontrado.")
        user.is_active = False
        user.updated_at = datetime.utcnow()
        self.session.flush()
        return user

    def activate_user(self, user_id: UUID) -> AuthUser:
        user = self.session.get(AuthUser, user_id)
        if user is None:
            raise AuthError("Usuario no encontrado.")
        user.is_active = True
        user.updated_at = datetime.utcnow()
        self.session.flush()
        return user

    def reset_user_password(self, user_id: UUID) -> tuple[AuthUser, str]:
        user = self.session.get(AuthUser, user_id)
        if user is None:
            raise AuthError("Usuario no encontrado.")
        temporary_password = generate_temporary_password()
        user.password_hash = hash_password(temporary_password)
        user.must_change_password = True
        user.updated_at = datetime.utcnow()
        self.session.flush()
        return user, temporary_password

    def set_initial_password(self, user_id: UUID, new_password: str) -> AuthUser:
        """Cambio forzado tras el primer login (contrasena temporal).

        No pide la contrasena actual porque el usuario acaba de autenticarse con
        ella. Solo aplica si el usuario tiene el cambio pendiente.
        """
        user = self.session.get(AuthUser, user_id)
        if user is None:
            raise AuthError("Usuario no encontrado.")
        if not user.must_change_password:
            raise AuthError("El cambio inicial no esta habilitado para este usuario.")
        if verify_password(new_password, user.password_hash):
            raise AuthError("La nueva contrasena debe ser distinta de la temporal.")
        validate_password_strength(new_password)
        user.password_hash = hash_password(new_password)
        user.must_change_password = False
        user.updated_at = datetime.utcnow()
        self.session.flush()
        return user

    def change_password(self, user_id: UUID, current_password: str, new_password: str) -> AuthUser:
        user = self.session.get(AuthUser, user_id)
        if user is None:
            raise AuthError("Usuario no encontrado.")
        if not verify_password(current_password, user.password_hash):
            raise AuthError("La contrasena actual es incorrecta.")
        if verify_password(new_password, user.password_hash):
            raise AuthError("La nueva contrasena debe ser distinta de la actual.")
        validate_password_strength(new_password)
        user.password_hash = hash_password(new_password)
        user.must_change_password = False
        user.updated_at = datetime.utcnow()
        self.session.flush()
        return user

    @staticmethod
    def _ensure_role(role: str) -> None:
        if role not in SYSTEM_ROLES:
            raise AuthError("Rol invalido.")

    @staticmethod
    def _permissions_for_role(role: str) -> list[str]:
        return ROLE_PERMISSIONS.get(role, [])

    def _generate_available_username(
        self,
        first_name: str,
        last_name: str,
        role: str,
        exclude_user_id: UUID | None = None,
    ) -> str:
        base_username = generate_username_base(first_name, last_name)
        candidate = base_username
        suffix = 2
        while self._username_or_email_exists(candidate, role, exclude_user_id):
            candidate = f"{base_username}{suffix}"
            suffix += 1
        return candidate

    def _username_or_email_exists(self, username: str, role: str, exclude_user_id: UUID | None) -> bool:
        email = generate_system_email(username, role)
        statement = select(AuthUser).where((AuthUser.username == username) | (AuthUser.email == email))
        if exclude_user_id is not None:
            statement = statement.where(AuthUser.id != exclude_user_id)
        return self.session.execute(statement).scalar_one_or_none() is not None


def seed_default_users(session: Session) -> None:
    disable_removed_users(session, usernames=("owner",))
    password = settings.seed_admin_password
    generated = False
    if not password:
        password = generate_temporary_password()
        generated = True
    created = seed_user(
        session,
        username=settings.seed_admin_username,
        password=password,
        role=ROLE_ADMIN,
        permissions=ADMIN_PERMISSIONS,
        reset_password=settings.seed_admin_reset_on_boot,
        must_change_password=True,
    )
    session.commit()
    if created and generated:
        logger.warning(
            "Usuario admin '%s' creado con contraseña generada aleatoriamente: %s "
            "-- cambiela tras el primer inicio de sesion. Este mensaje solo aparece al crearse.",
            settings.seed_admin_username,
            password,
        )


def disable_removed_users(session: Session, *, usernames: tuple[str, ...]) -> None:
    for username in usernames:
        user = session.execute(select(AuthUser).where(AuthUser.username == username)).scalar_one_or_none()
        if user is not None:
            user.is_active = False
            user.updated_at = datetime.utcnow()


def seed_user(
    session: Session,
    *,
    username: str,
    password: str,
    role: str,
    permissions: list[str],
    reset_password: bool = False,
    must_change_password: bool = False,
) -> bool:
    """Crea el usuario si no existe. Devuelve True solo cuando se crea.

    Para usuarios ya existentes se sincronizan rol, permisos y estado, pero la
    contraseña NO se sobrescribe salvo que ``reset_password`` sea True. Esto evita
    revertir la contraseña del admin en cada arranque.
    """
    user = session.execute(select(AuthUser).where(AuthUser.username == username)).scalar_one_or_none()
    if user is None:
        session.add(
            AuthUser(
                username=username,
                first_name="Admin",
                last_name="Sistema",
                email=generate_system_email(username, role),
                password_hash=hash_password(password),
                role=role,
                permissions=permissions,
                is_active=True,
                must_change_password=must_change_password,
            )
        )
        return True

    user.role = role
    user.permissions = permissions
    user.first_name = user.first_name or "Admin"
    user.last_name = user.last_name or "Sistema"
    # Re-sincroniza el correo del sistema para que un cambio de dominio
    # (SYSTEM_EMAIL_DOMAIN) aplique a usuarios sembrados ya existentes.
    user.email = generate_system_email(username, role)
    user.is_active = True
    if reset_password:
        user.password_hash = hash_password(password)
    user.updated_at = datetime.utcnow()
    return False
