import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from sqlalchemy import text

from backend.modules.auth.router import router as auth_router
from backend.modules.auth import models as auth_models
from backend.modules.auth.service import seed_default_users
from backend.modules.catalog import models as catalog_models
from backend.modules.catalog.router import router as catalog_router
from backend.modules.catalog.service import seed_catalog
from backend.modules.config.settings import settings
from backend.modules.database.base import Base
from backend.modules.database.session import SessionLocal, engine
from backend.modules.inventory import models as inventory_models
from backend.modules.inventory.repository import InventoryRepository
from backend.modules.inventory.router import router as inventory_router
from backend.modules.inventory.service import InventoryService
from backend.modules.production import models as production_models
from backend.modules.production.repository import ProductionProcessRepository
from backend.modules.production.router import router as production_router
from backend.modules.production.service import ProductionService


app = FastAPI(
    title="ERP Joyeria API",
    docs_url="/docs" if settings.enable_docs else None,
    redoc_url="/redoc" if settings.enable_docs else None,
    openapi_url="/openapi.json" if settings.enable_docs else None,
)

allowed_hosts = [host.strip() for host in settings.allowed_hosts.split(",") if host.strip()]
if allowed_hosts:
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=allowed_hosts)

cors_origins = [origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()]
if cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
        max_age=600,
    )


SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
    # API JSON: bloquea render de contenido activo si un endpoint devolviera HTML.
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
}


@app.middleware("http")
async def apply_security_headers(request: Request, call_next):
    response = await call_next(request)
    for header, value in SECURITY_HEADERS.items():
        response.headers.setdefault(header, value)
    # HSTS solo bajo HTTPS (produccion tras TLS). Evita romper HTTP local.
    if settings.is_production or request.url.scheme == "https":
        response.headers.setdefault(
            "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
        )
    return response


@app.on_event("startup")
def create_dev_tables() -> None:
    if settings.is_production and settings.auto_create_tables:
        logging.getLogger(__name__).warning(
            "AUTO_CREATE_TABLES esta activo en produccion. Migra a Alembic y "
            "desactivalo (AUTO_CREATE_TABLES=false) antes del despliegue final."
        )
    if settings.auto_create_tables:
        drop_obsolete_production_tables()
        Base.metadata.create_all(bind=engine)
        upgrade_auth_users_table()
        upgrade_inventory_movements_table()
        upgrade_production_tables()
        session = SessionLocal()
        try:
            seed_default_users(session)
            ProductionService(
                repository=ProductionProcessRepository(session),
                inventory_service=InventoryService(repository=InventoryRepository(session)),
            ).seed_example_processes()
            seed_catalog(session)
            session.commit()
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
        "ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS employee_code VARCHAR(10)",
        "ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE",
        "WITH ordered AS (SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) AS rn FROM auth_users) "
        "UPDATE auth_users u SET employee_code = LPAD(o.rn::text, 2, '0') "
        "FROM ordered o WHERE u.id = o.id AND u.employee_code IS NULL",
    )
    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))


def upgrade_inventory_movements_table() -> None:
    statements = (
        "ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS source_file_name VARCHAR(240)",
        "ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS source_file_mime VARCHAR(120)",
        "ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS source_file_content TEXT",
        "ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS lot_code VARCHAR(30)",
    )
    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))


def upgrade_production_tables() -> None:
    statements = (
        "ALTER TABLE production_processes ADD COLUMN IF NOT EXISTS raw_material_item_id UUID",
        "ALTER TABLE production_processes ADD COLUMN IF NOT EXISTS raw_material_quantity_per_unit NUMERIC(14, 4)",
        "ALTER TABLE production_processes ADD COLUMN IF NOT EXISTS raw_material_unit_code VARCHAR(20)",
        "ALTER TABLE production_processes ADD COLUMN IF NOT EXISTS waste_limit_percent NUMERIC(7, 4) NOT NULL DEFAULT 5",
        "ALTER TABLE production_process_stages ADD COLUMN IF NOT EXISTS phase_name VARCHAR(120)",
        "ALTER TABLE production_process_stages ADD COLUMN IF NOT EXISTS stage_type VARCHAR(40) NOT NULL DEFAULT 'PROCESS'",
        "ALTER TABLE production_process_stages ADD COLUMN IF NOT EXISTS quality_check TEXT",
        "ALTER TABLE production_process_stages ADD COLUMN IF NOT EXISTS rework_action TEXT",
        "ALTER TABLE production_runs ADD COLUMN IF NOT EXISTS requested_at TIMESTAMPTZ",
        "UPDATE production_runs SET requested_at = COALESCE(requested_at, started_at, NOW())",
        "ALTER TABLE production_runs ALTER COLUMN requested_at SET NOT NULL",
        "ALTER TABLE production_runs ALTER COLUMN requested_at SET DEFAULT NOW()",
        "ALTER TABLE production_runs ADD COLUMN IF NOT EXISTS materials_approved_at TIMESTAMPTZ",
        "ALTER TABLE production_runs ALTER COLUMN started_at DROP NOT NULL",
        "ALTER TABLE production_runs ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ",
        "ALTER TABLE production_run_stages ADD COLUMN IF NOT EXISTS phase_name VARCHAR(120)",
        "ALTER TABLE production_run_stages ADD COLUMN IF NOT EXISTS stage_type VARCHAR(40) NOT NULL DEFAULT 'PROCESS'",
        "ALTER TABLE production_run_stages ADD COLUMN IF NOT EXISTS quality_check TEXT",
        "ALTER TABLE production_run_stages ADD COLUMN IF NOT EXISTS rework_action TEXT",
        "CREATE TABLE IF NOT EXISTS production_process_stage_ingredients (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), stage_id UUID NOT NULL REFERENCES production_process_stages(id) ON DELETE CASCADE, inventory_item_id UUID NOT NULL, quantity NUMERIC(14,4) NOT NULL, unit_code VARCHAR(20) NOT NULL)",
        "ALTER TABLE production_runs ADD COLUMN IF NOT EXISTS production_code VARCHAR(30)",
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_production_runs_production_code ON production_runs (production_code) WHERE production_code IS NOT NULL",
        "ALTER TABLE production_run_stages ADD COLUMN IF NOT EXISTS stage_code VARCHAR(40)",
        "ALTER TABLE production_runs ADD COLUMN IF NOT EXISTS started_by_user_id UUID",
        "ALTER TABLE production_runs ADD COLUMN IF NOT EXISTS materials_approved_by_user_id UUID",
        "ALTER TABLE production_runs ADD COLUMN IF NOT EXISTS received_by_user_id UUID",
        "ALTER TABLE production_run_stages ADD COLUMN IF NOT EXISTS finished_by_user_id UUID",
        "ALTER TABLE production_process_stages ADD COLUMN IF NOT EXISTS rework_target_order INTEGER",
        "ALTER TABLE production_run_stages ADD COLUMN IF NOT EXISTS rework_target_order INTEGER",
        "ALTER TABLE production_processes ADD COLUMN IF NOT EXISTS code VARCHAR(10)",
        "WITH ordered AS (SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) AS rn FROM production_processes) "
        "UPDATE production_processes p SET code = (2000 + o.rn - 1)::text "
        "FROM ordered o WHERE p.id = o.id AND p.code IS NULL",
        "ALTER TABLE production_processes ADD COLUMN IF NOT EXISTS product_code VARCHAR(20)",
        "ALTER TABLE production_runs ADD COLUMN IF NOT EXISTS product_code VARCHAR(20)",
        "ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS product_code VARCHAR(20)",
        "ALTER TABLE production_runs ADD COLUMN IF NOT EXISTS rejected_by_user_id UUID",
        "ALTER TABLE production_runs ADD COLUMN IF NOT EXISTS rejection_reason TEXT",
        "CREATE TABLE IF NOT EXISTS production_run_stage_decisions ("
        "id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "
        "run_id UUID NOT NULL, "
        "run_stage_id UUID NOT NULL REFERENCES production_run_stages(id) ON DELETE CASCADE, "
        "decision VARCHAR(20) NOT NULL, "
        "justification TEXT, "
        "weight_based BOOLEAN NOT NULL DEFAULT FALSE, "
        "final_weight NUMERIC(14,4), "
        "returned_to_order INTEGER, "
        "decided_by_user_id UUID, "
        "decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), "
        "attempt_no INTEGER NOT NULL DEFAULT 1)",
    )
    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))


app.include_router(auth_router, prefix="/api/auth", tags=["auth"])
app.include_router(production_router, prefix="/api/production", tags=["production"])
app.include_router(inventory_router, prefix="/api/inventory", tags=["inventory"])
app.include_router(catalog_router, prefix="/api/catalog", tags=["catalog"])
