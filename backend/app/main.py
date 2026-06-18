from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from backend.modules.auth.router import router as auth_router
from backend.modules.auth import models as auth_models
from backend.modules.auth.service import seed_default_users
from backend.modules.config.settings import settings
from backend.modules.database.base import Base
from backend.modules.database.session import SessionLocal, engine
from backend.modules.inventory import models as inventory_models
from backend.modules.inventory.router import router as inventory_router
from backend.modules.production import models as production_models
from backend.modules.production.router import router as production_router


app = FastAPI(title="ERP Joyeria API")

cors_origins = [origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()]
if cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )


@app.on_event("startup")
def create_dev_tables() -> None:
    if settings.auto_create_tables:
        drop_obsolete_production_tables()
        Base.metadata.create_all(bind=engine)
        upgrade_auth_users_table()
        upgrade_inventory_movements_table()
        session = SessionLocal()
        try:
            seed_default_users(session)
        finally:
            session.close()


def drop_obsolete_production_tables() -> None:
    obsolete_tables = (
        "production_order_stages",
        "production_orders",
        "production_process_template_stages",
        "production_process_templates",
    )
    with engine.begin() as connection:
        for table_name in obsolete_tables:
            connection.execute(text(f"DROP TABLE IF EXISTS {table_name} CASCADE"))


def upgrade_auth_users_table() -> None:
    statements = (
        "ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS first_name VARCHAR(120)",
        "ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS last_name VARCHAR(120)",
        "ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS email VARCHAR(180)",
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_auth_users_email ON auth_users (email)",
    )
    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))


def upgrade_inventory_movements_table() -> None:
    statements = (
        "ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS source_file_name VARCHAR(240)",
        "ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS source_file_mime VARCHAR(120)",
        "ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS source_file_content TEXT",
    )
    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))


app.include_router(auth_router, prefix="/api/auth", tags=["auth"])
app.include_router(production_router, prefix="/api/production", tags=["production"])
app.include_router(inventory_router, prefix="/api/inventory", tags=["inventory"])
