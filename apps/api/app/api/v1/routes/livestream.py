from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, status
from pydantic import BaseModel, Field

from app.core.config import settings
from app.services.dji_mqtt import dji_mqtt_consumer


router = APIRouter(prefix="/livestreams", tags=["livestream"])


class LiveStartRequest(BaseModel):
    gateway_sn: str = Field(min_length=3)
    video_id: str = Field(min_length=3)
    video_quality: int = Field(default=0, ge=0, le=4)


class LiveStopRequest(BaseModel):
    gateway_sn: str = Field(min_length=3)
    video_id: str = Field(min_length=3)


def require_platform_token(token: str | None) -> None:
    if not settings.dji_pilot_api_token or token != settings.dji_pilot_api_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")


@router.post("/start")
async def start_livestream(
    payload: LiveStartRequest,
    x_auth_token: Annotated[str | None, Header()] = None,
) -> dict[str, object]:
    require_platform_token(x_auth_token)
    url = f"rtmp://{settings.stream_public_host}:{settings.stream_rtmp_port}/live/{payload.gateway_sn}"
    data = {
        "url_type": 1,
        "url": url,
        "video_id": payload.video_id,
        "video_quality": payload.video_quality,
    }
    try:
        published = dji_mqtt_consumer.publish_service(payload.gateway_sn, "live_start_push", data)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    return {"status": "sent", "method": "live_start_push", "stream_url": url, "data": data, **published}


@router.post("/stop")
async def stop_livestream(
    payload: LiveStopRequest,
    x_auth_token: Annotated[str | None, Header()] = None,
) -> dict[str, object]:
    require_platform_token(x_auth_token)
    data = {"video_id": payload.video_id}
    try:
        published = dji_mqtt_consumer.publish_service(payload.gateway_sn, "live_stop_push", data)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    return {"status": "sent", "method": "live_stop_push", "data": data, **published}
