from fastapi import APIRouter

from app.core.config import settings

router = APIRouter()


@router.get("/config")
async def system_config() -> dict[str, str | int]:
    return {
        "root_domain": settings.root_domain,
        "api_host": f"api.{settings.root_domain}",
        "pilot_host": f"pilot.{settings.root_domain}",
        "mqtt_host": settings.mqtt_public_host,
        "mqtt_tls_port": settings.mqtt_tls_port,
        "stream_host": settings.stream_public_host,
        "stream_rtmp_port": settings.stream_rtmp_port,
    }

