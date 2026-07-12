from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.core.config import settings
from app.services.dji_mqtt import dji_mqtt_consumer
from app.api.dependencies.auth import ALL_ROLES, STREAM_ROLES, AuthenticatedUser, require_roles
from app.api.v1.routes.auth import verify_csrf


router = APIRouter(prefix="/livestreams", tags=["livestream"])


@router.get("/options")
async def livestream_options(
    _: Annotated[AuthenticatedUser, Depends(require_roles(ALL_ROLES))],
) -> dict[str, object]:
    """List video sources currently advertised by DJI Pilot 2."""
    return {"options": dji_mqtt_consumer.livestream_options()}


class LiveStartRequest(BaseModel):
    gateway_sn: str = Field(min_length=3)
    video_id: str = Field(min_length=3)
    video_quality: int = Field(default=0, ge=0, le=4)


class LiveStopRequest(BaseModel):
    gateway_sn: str = Field(min_length=3)
    video_id: str = Field(min_length=3)


@router.post("/start", dependencies=[Depends(verify_csrf)])
async def start_livestream(
    payload: LiveStartRequest,
    _: Annotated[AuthenticatedUser, Depends(require_roles(STREAM_ROLES))],
) -> dict[str, object]:
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


@router.post("/stop", dependencies=[Depends(verify_csrf)])
async def stop_livestream(
    payload: LiveStopRequest,
    _: Annotated[AuthenticatedUser, Depends(require_roles(STREAM_ROLES))],
) -> dict[str, object]:
    data = {"video_id": payload.video_id}
    try:
        published = dji_mqtt_consumer.publish_service(payload.gateway_sn, "live_stop_push", data)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    return {"status": "sent", "method": "live_stop_push", "data": data, **published}
