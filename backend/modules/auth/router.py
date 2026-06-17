from fastapi import APIRouter


router = APIRouter()


@router.get("/health")
def auth_health() -> dict[str, str]:
    return {"module": "auth", "status": "pending"}
