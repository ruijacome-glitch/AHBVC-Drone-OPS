from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.core.config import settings

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


class PilotAuthRequest(BaseModel):
    username: str = Field(min_length=1)
    password: str = Field(min_length=1)


class GatewayRegistration(BaseModel):
    gateway_sn: str = Field(min_length=3)
    callsign: str | None = None
    model: str | None = None


class DroneRegistration(BaseModel):
    drone_sn: str = Field(min_length=3)
    gateway_sn: str = Field(min_length=3)
    model: str
    payload: str | None = None


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
async def pilot_jsbridge_config() -> PilotJsBridgeConfigResponse:
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
        mqtt_url=f"{settings.mqtt_public_scheme}://{settings.mqtt_public_host}:{settings.mqtt_tls_port}",
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


@router.post("/pilot/auth")
async def pilot_auth(_: PilotAuthRequest) -> dict[str, str]:
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail=(
            f"{DJI_DOCS_NOTE} Configure DJI Developer Portal credentials first: "
            "App ID, App Key/App Secret, App Basic License, workspace identifier, "
            "and Pilot 2 Open Platform URL."
        ),
    )


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
