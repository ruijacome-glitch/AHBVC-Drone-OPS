from fastapi import APIRouter

from app.core.config import settings

router = APIRouter(tags=["health"])


@router.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok", "service": "uas-platform-api"}


@router.get("/readyz")
async def readyz() -> dict[str, str]:
    return {
        "status": "ready",
        "database": settings.database_url.split("@")[-1],
        "mqtt": f"{settings.mqtt_internal_host}:{settings.mqtt_internal_port}",
    }

