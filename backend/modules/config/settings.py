from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://user:password@localhost:5432/erp_joyeria"
    jwt_secret_key: str = "change-me"
    jwt_refresh_secret_key: str = "change-me"
    cors_origins: str = ""
    redis_url: str | None = None


settings = Settings()
