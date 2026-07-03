from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


INSECURE_SECRET_DEFAULTS = {"", "change-me", "dev-change-me"}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "development"
    database_url: str = "postgresql+psycopg://user:password@localhost:5432/erp_joyeria"
    jwt_secret_key: str = "change-me"
    jwt_refresh_secret_key: str = "change-me"
    cors_origins: str = ""
    allowed_hosts: str = ""
    enable_docs: bool = True
    redis_url: str | None = None
    auto_create_tables: bool = False
    # Siembra datos base (admin, procesos y catalogo de ejemplo) al arrancar.
    # Desacoplado de auto_create_tables: el esquema lo gestiona Alembic.
    seed_on_startup: bool = False
    dev_auth_enabled: bool = False
    dev_user_id: str = "00000000-0000-0000-0000-000000000001"
    dev_username: str = "admin"
    access_token_expire_minutes: int = 480
    login_rate_limit_max: int = 5
    login_rate_limit_window_seconds: int = 60
    seed_admin_username: str = "admin"
    seed_admin_password: str | None = None
    seed_admin_reset_on_boot: bool = False
    system_email_domain: str = "erp.local"

    @property
    def is_production(self) -> bool:
        return self.app_env.strip().lower() in {"production", "prod"}

    @model_validator(mode="after")
    def _enforce_production_hardening(self) -> "Settings":
        if not self.is_production:
            return self
        errors: list[str] = []
        if self.jwt_secret_key in INSECURE_SECRET_DEFAULTS:
            errors.append("JWT_SECRET_KEY debe definirse con un valor fuerte en produccion.")
        if self.jwt_refresh_secret_key in INSECURE_SECRET_DEFAULTS:
            errors.append("JWT_REFRESH_SECRET_KEY debe definirse con un valor fuerte en produccion.")
        if self.jwt_secret_key == self.jwt_refresh_secret_key:
            errors.append("JWT_SECRET_KEY y JWT_REFRESH_SECRET_KEY deben ser distintos.")
        if not self.cors_origins.strip():
            errors.append("CORS_ORIGINS debe listar los dominios permitidos en produccion.")
        if not self.allowed_hosts.strip():
            errors.append("ALLOWED_HOSTS debe listar los hosts permitidos en produccion.")
        if self.dev_auth_enabled:
            errors.append("DEV_AUTH_ENABLED debe ser false en produccion.")
        if self.enable_docs:
            errors.append("ENABLE_DOCS debe ser false en produccion.")
        if not (self.seed_admin_password or "").strip():
            errors.append(
                "SEED_ADMIN_PASSWORD debe definirse en produccion para crear el "
                "admin inicial con una clave conocida (no aleatoria)."
            )
        if errors:
            raise ValueError("Configuracion insegura para produccion:\n- " + "\n- ".join(errors))
        return self


settings = Settings()
