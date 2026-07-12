import json
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.api.dependencies.auth import AuthenticatedUser, PILOT_ROLES, require_roles
from app.api.v1.routes.auth import verify_csrf
from app.core.config import settings
from app.db.session import AsyncSessionLocal
from app.services.dji_mqtt import dji_mqtt_consumer

router = APIRouter()

DJI_DOCS_NOTE = (
    "TODO(DJI Cloud API): validate request/response payload against the official DJI "
    "Cloud API documentation before enabling this endpoint for DJI Pilot 2."
)


class PilotBootstrapResponse(BaseModel):
    workspace_id: str | None
    workspace_name: str
    api_host: str
    mqtt_host: str
    mqtt_port: int
    stream_rtmp_url_template: str
    dji_app_id_configured: bool
    dji_app_key_configured: bool
    dji_basic_license_configured: bool
    docs_url: str
    todo: str


class PilotJsBridgeConfigResponse(BaseModel):
    setup_ready: bool
    missing_config: list[str]
    app_id: str | None
    app_key: str | None
    app_basic_license: str | None
    workspace_id: str | None
    workspace_name: str
    platform_name: str
    platform_description: str
    api_host: str
    api_token: str | None
    mqtt_url: str
    mqtt_username: str | None
    mqtt_password: str | None
    ws_host: str | None
    stream_rtmp_url_template: str
    docs_url: str
    todo: str


class GatewayRegistration(BaseModel):
    gateway_sn: str = Field(min_length=3)
    callsign: str | None = None
    model: str | None = None


class DroneRegistration(BaseModel):
    drone_sn: str = Field(min_length=3)
    gateway_sn: str = Field(min_length=3)
    model: str
    payload: str | None = None


class PilotSessionRequest(BaseModel):
    controller_sn: str = Field(min_length=3, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    aircraft_sn: str | None = Field(default=None, min_length=3, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")


class PilotSessionResponse(BaseModel):
    id: UUID
    pilot_name: str
    controller_sn: str
    aircraft_sn: str | None
    status: str


@router.get("/pilot/bootstrap", response_model=PilotBootstrapResponse)
async def pilot_bootstrap() -> PilotBootstrapResponse:
    return PilotBootstrapResponse(
        workspace_id=settings.dji_workspace_id,
        workspace_name=settings.dji_workspace_name,
        api_host=f"https://api.{settings.root_domain}",
        mqtt_host=settings.mqtt_public_host,
        mqtt_port=settings.mqtt_tls_port,
        stream_rtmp_url_template=f"rtmp://{settings.stream_public_host}:1935/live/{{gateway_sn}}",
        dji_app_id_configured=bool(settings.dji_app_id),
        dji_app_key_configured=bool(settings.dji_app_key),
        dji_basic_license_configured=bool(settings.dji_app_basic_license),
        docs_url=str(settings.dji_cloud_api_docs_url),
        todo=DJI_DOCS_NOTE,
    )


@router.get("/pilot/jsbridge-config", response_model=PilotJsBridgeConfigResponse)
async def pilot_jsbridge_config(
    _: Annotated[AuthenticatedUser, Depends(require_roles(PILOT_ROLES))],
) -> PilotJsBridgeConfigResponse:
    required_values = {
        "DJI_APP_ID": settings.dji_app_id,
        "DJI_APP_KEY": settings.dji_app_key,
        "DJI_APP_BASIC_LICENSE": settings.dji_app_basic_license,
        "DJI_WORKSPACE_ID": settings.dji_workspace_id,
        "DJI_PILOT_API_TOKEN": settings.dji_pilot_api_token,
        "MQTT_PILOT_USERNAME": settings.mqtt_pilot_username,
        "MQTT_PILOT_PASSWORD": settings.mqtt_pilot_password,
    }
    missing_config = [key for key, value in required_values.items() if not value]

    return PilotJsBridgeConfigResponse(
        setup_ready=not missing_config,
        missing_config=missing_config,
        app_id=settings.dji_app_id,
        app_key=settings.dji_app_key,
        app_basic_license=settings.dji_app_basic_license,
        workspace_id=settings.dji_workspace_id,
        workspace_name=settings.dji_workspace_name,
        platform_name="UAS Platform",
        platform_description="AHBVC DJI Enterprise operations platform.",
        api_host=f"https://api.{settings.root_domain}",
        api_token=settings.dji_pilot_api_token,
        mqtt_url=settings.pilot_mqtt_url,
        mqtt_username=settings.mqtt_pilot_username,
        mqtt_password=settings.mqtt_pilot_password,
        ws_host=(
            f"wss://api.{settings.root_domain}/manage/api/v1/workspaces/"
            f"{settings.dji_workspace_id}/websocket"
            if settings.dji_workspace_id
            else None
        ),
        stream_rtmp_url_template=f"rtmp://{settings.stream_public_host}:1935/live/{{gateway_sn}}",
        docs_url="https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/jsbridge.html",
        todo=(
            "TODO(DJI Cloud API): validate ws/tsa module parameters and Situation "
            "Awareness event payloads with the official DJI documentation and real hardware."
        ),
    )


@router.get("/pilot/mqtt-status")
async def pilot_mqtt_status(
    _: Annotated[AuthenticatedUser, Depends(require_roles(PILOT_ROLES))],
) -> dict[str, object]:
    return dji_mqtt_consumer.snapshot()


@router.post(
    "/pilot/operator-sessions",
    response_model=PilotSessionResponse,
    dependencies=[Depends(verify_csrf)],
)
async def start_pilot_session(
    payload: PilotSessionRequest,
    user: Annotated[AuthenticatedUser, Depends(require_roles(PILOT_ROLES))],
) -> PilotSessionResponse:
    async with AsyncSessionLocal() as session, session.begin():
        await session.execute(
            text(
                """
                UPDATE pilot_sessions
                SET status = 'closed', disconnected_at = now(), last_seen_at = now()
                WHERE controller_sn = :controller_sn AND status = 'active'
                """
            ),
            {"controller_sn": payload.controller_sn},
        )
        result = await session.execute(
            text(
                """
                INSERT INTO pilot_sessions (
                    user_id, organisation_id, controller_sn, aircraft_sn
                ) VALUES (
                    :user_id, :organisation_id, :controller_sn, :aircraft_sn
                )
                RETURNING id, controller_sn, aircraft_sn, status
                """
            ),
            {
                "user_id": user.id,
                "organisation_id": user.organisation_id,
                "controller_sn": payload.controller_sn,
                "aircraft_sn": payload.aircraft_sn,
            },
        )
        row = result.mappings().one()
        await session.execute(
            text(
                """
                INSERT INTO audit_logs (
                    actor_user_id, organisation_id, action, entity_type, entity_id, metadata
                ) VALUES (
                    :user_id, :organisation_id, 'pilot.session.start',
                    'pilot_session', :session_id, CAST(:metadata AS jsonb)
                )
                """
            ),
            {
                "user_id": user.id,
                "organisation_id": user.organisation_id,
                "session_id": str(row["id"]),
                "metadata": json.dumps(
                    {"controller_sn": payload.controller_sn, "aircraft_sn": payload.aircraft_sn}
                ),
            },
        )
    return PilotSessionResponse(pilot_name=user.full_name, **row)


@router.post(
    "/pilot/operator-sessions/{session_id}/heartbeat",
    dependencies=[Depends(verify_csrf)],
)
async def heartbeat_pilot_session(
    session_id: UUID,
    user: Annotated[AuthenticatedUser, Depends(require_roles(PILOT_ROLES))],
) -> dict[str, str]:
    async with AsyncSessionLocal() as session, session.begin():
        result = await session.execute(
            text(
                """
                UPDATE pilot_sessions SET last_seen_at = now()
                WHERE id = :session_id AND user_id = :user_id AND status = 'active'
                RETURNING id
                """
            ),
            {"session_id": session_id, "user_id": user.id},
        )
        if result.first() is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Active pilot session not found")
    return {"status": "active"}


@router.post(
    "/pilot/operator-sessions/{session_id}/close",
    dependencies=[Depends(verify_csrf)],
)
async def close_pilot_session(
    session_id: UUID,
    user: Annotated[AuthenticatedUser, Depends(require_roles(PILOT_ROLES))],
) -> dict[str, str]:
    async with AsyncSessionLocal() as session, session.begin():
        await session.execute(
            text(
                """
                UPDATE pilot_sessions
                SET status = 'closed', disconnected_at = now(), last_seen_at = now()
                WHERE id = :session_id AND user_id = :user_id AND status = 'active'
                """
            ),
            {"session_id": session_id, "user_id": user.id},
        )
    return {"status": "closed"}


@router.post("/gateways")
async def register_gateway(payload: GatewayRegistration) -> dict[str, str]:
    return {
        "status": "accepted",
        "gateway_sn": payload.gateway_sn,
        "todo": "Persist gateway/controller after SQLAlchemy repositories are enabled.",
    }


@router.post("/drones")
async def register_drone(payload: DroneRegistration) -> dict[str, str]:
    return {
        "status": "accepted",
        "drone_sn": payload.drone_sn,
        "gateway_sn": payload.gateway_sn,
        "todo": "Persist drone and online/offline state after repositories are enabled.",
    }


@router.get("/mqtt/topics/{gateway_sn}")
async def mqtt_topics(gateway_sn: str) -> dict[str, list[str] | str]:
    topics = [
        f"thing/product/{gateway_sn}/osd",
        f"thing/product/{gateway_sn}/state",
        f"thing/product/{gateway_sn}/services",
        f"thing/product/{gateway_sn}/events",
        f"thing/product/{gateway_sn}/requests",
        f"thing/product/{gateway_sn}/property/set_reply",
    ]
    return {"gateway_sn": gateway_sn, "subscribe_topics": topics, "todo": DJI_DOCS_NOTE}
