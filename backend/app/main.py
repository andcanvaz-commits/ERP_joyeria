from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.modules.auth.router import router as auth_router
from backend.modules.auth import models as auth_models
from backend.modules.auth.service import seed_default_users
from backend.modules.config.settings import settings
from backend.modules.database.base import Base
from backend.modules.database.session import SessionLocal, engine
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
        Base.metadata.create_all(bind=engine)
        session = SessionLocal()
        try:
            seed_default_users(session)
        finally:
            session.close()


app.include_router(auth_router, prefix="/api/auth", tags=["auth"])
app.include_router(production_router, prefix="/api/production", tags=["production"])
