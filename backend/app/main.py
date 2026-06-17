from fastapi import FastAPI

from backend.modules.auth.router import router as auth_router
from backend.modules.production.router import router as production_router


app = FastAPI(title="ERP Joyeria API")

app.include_router(auth_router, prefix="/api/auth", tags=["auth"])
app.include_router(production_router, prefix="/api/production", tags=["production"])
