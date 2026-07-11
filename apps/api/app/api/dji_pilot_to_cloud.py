from secrets import compare_digest
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field

from app.core.config import settings

router = APIRouter(tags=["dji-pilot-to-cloud"])

DJI_DEVICE_TOPOLOGY_DOCS_URL = (
    "https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/"
    "pilot-to-cloud/https/situation-awareness/obtain-device-topology-list.html"
)


class DjiDeviceModel(BaseModel):
    key: str
    domain: str
    type: str
    sub_type: str


class DjiTopologyDevice(BaseModel):
    device_callsign: str
    device_model: DjiDeviceModel
    icon_urls: dict[str, str] = Field(default_factory=dict)
    online_status: bool
    sn: str
    user_callsign: str
    user_id: str


class DjiDeviceTopology(BaseModel):
    hosts: list[DjiTopologyDevice] = Field(default_factory=list)
    parents: list[DjiTopologyDevice] = Field(default_factory=list)


class DjiDeviceTopologyData(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    topologies: list[DjiDeviceTopology] = Field(default_factory=list, alias="list")


class DjiDeviceTopologyResponse(BaseModel):
    code: int = 0
    message: str = "success"
    data: DjiDeviceTopologyData = Field(default_factory=DjiDeviceTopologyData)


class DjiDeviceBindingRequest(BaseModel):
    device_sn: str = Field(min_length=3)
    user_id: str = Field(min_length=1)
    workspace_id: str = Field(min_length=1)


_bound_devices: dict[str, DjiDeviceBindingRequest] = {}


async def verify_dji_pilot_token(
    x_auth_token: Annotated[str, Header(min_length=1, alias="x-auth-token")],
) -> None:
    expected_token = settings.dji_pilot_api_token
    if not expected_token or not compare_digest(x_auth_token, expected_token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized",
        )


@router.get(
    "/manage/api/v1/workspaces/{workspace_id}/devices/topologies",
    response_model=DjiDeviceTopologyResponse,
    summary="Obtain Device Topology List",
    dependencies=[Depends(verify_dji_pilot_token)],
)
async def obtain_device_topology_list(
    workspace_id: str,
) -> DjiDeviceTopologyResponse:
    """DJI Pilot 2 first-connection topology endpoint.

    Official DJI docs:
    https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/https/situation-awareness/obtain-device-topology-list.html
    The gateway model identifiers follow DJI's official Product Supported table:
    DJI RC Plus is domain=2, type=119, sub_type=0. Aircraft hosts remain empty
    until their real serial number is observed from MQTT.
    """
    if workspace_id != settings.dji_workspace_id or not settings.dji_gateway_sn:
        return DjiDeviceTopologyResponse()

    gateway_model = DjiDeviceModel(
        key=(
            f"{settings.dji_gateway_model_domain}-"
            f"{settings.dji_gateway_model_type}-"
            f"{settings.dji_gateway_model_sub_type}"
        ),
        domain=settings.dji_gateway_model_domain,
        type=settings.dji_gateway_model_type,
        sub_type=settings.dji_gateway_model_sub_type,
    )
    gateway = DjiTopologyDevice(
        device_callsign=settings.dji_gateway_callsign,
        device_model=gateway_model,
        online_status=True,
        sn=settings.dji_gateway_sn,
        user_callsign=settings.dji_workspace_name,
        user_id=settings.dji_workspace_id or "",
    )
    aircraft = None
    if settings.dji_aircraft_sn:
        aircraft_model = DjiDeviceModel(
            key=(
                f"{settings.dji_aircraft_model_domain}-"
                f"{settings.dji_aircraft_model_type}-"
                f"{settings.dji_aircraft_model_sub_type}"
            ),
            domain=settings.dji_aircraft_model_domain,
            type=settings.dji_aircraft_model_type,
            sub_type=settings.dji_aircraft_model_sub_type,
        )
        aircraft = DjiTopologyDevice(
            device_callsign=settings.dji_aircraft_callsign,
            device_model=aircraft_model,
            online_status=True,
            sn=settings.dji_aircraft_sn,
            user_callsign=settings.dji_workspace_name,
            user_id=settings.dji_workspace_id or "",
        )
    return DjiDeviceTopologyResponse(
        data=DjiDeviceTopologyData(
            topologies=[DjiDeviceTopology(hosts=[aircraft] if aircraft else [], parents=[gateway])]
        )
    )


@router.post(
    "/manage/api/v1/devices/{device_sn}/binding",
    dependencies=[Depends(verify_dji_pilot_token)],
)
async def bind_device(
    device_sn: str,
    payload: DjiDeviceBindingRequest,
) -> dict[str, object]:
    """Bind a Pilot gateway to the workspace, matching the DJI demo flow."""
    if payload.device_sn != device_sn or payload.workspace_id != settings.dji_workspace_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid device binding")
    _bound_devices[device_sn] = payload
    return {"code": 0, "message": "success", "data": {}}
