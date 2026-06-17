from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://user:password@localhost:5432/erp_joyeria"
    jwt_secret_key: str = "change-me"
    jwt_refresh_secret_key: str = "change-me"
    cors_origins: str = ""
    redis_url: str | None = None
    auto_create_tables: bool = False
    dev_auth_enabled: bool = False
    dev_user_id: str = "00000000-0000-0000-0000-000000000001"
    dev_username: str = "jefe_produccion_dev"
    access_token_expire_minutes: int = 480
    seed_owner_username: str = "owner"
    seed_owner_password: str = "Owner123!"
    seed_admin_username: str = "admin"
    seed_admin_password: str = "Admin123!"


settings = Settings()
