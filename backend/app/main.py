from fastapi import FastAPI

from backend.modules.auth.router import router as auth_router
from backend.modules.config.settings import settings
from backend.modules.database.base import Base
from backend.modules.database.session import engine
from backend.modules.production import models as production_models
from backend.modules.production.router import router as production_router


app = FastAPI(title="ERP Joyeria API")


@app.on_event("startup")
def create_dev_tables() -> None:
    if settings.auto_create_tables:
        Base.metadata.create_all(bind=engine)


app.include_router(auth_router, prefix="/api/auth", tags=["auth"])
app.include_router(production_router, prefix="/api/production", tags=["production"])
