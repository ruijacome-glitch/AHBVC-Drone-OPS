from typing import Annotated, Any

from fastapi import APIRouter, Header
from pydantic import BaseModel, ConfigDict, Field

router = APIRouter(tags=["dji-pilot-to-cloud"])

DJI_DEVICE_TOPOLOGY_DOCS_URL = (
    "https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/"
    "pilot-to-cloud/https/situation-awareness/obtain-device-topology-list.html"
)


class DjiDeviceTopologyData(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    # TODO(DJI Cloud API): populate from registered gateways/drones after validating
    # Matrice 30T/Matrice 4T device_model enum values against official DJI docs.
    topologies: list[dict[str, Any]] = Field(default_factory=list, alias="list")


class DjiDeviceTopologyResponse(BaseModel):
    code: int = 0
    message: str = "success"
    data: DjiDeviceTopologyData = Field(default_factory=DjiDeviceTopologyData)


@router.get(
    "/manage/api/v1/workspaces/{workspace_id}/devices/topologies",
    response_model=DjiDeviceTopologyResponse,
    summary="Obtain Device Topology List",
)
async def obtain_device_topology_list(
    workspace_id: str,
    x_auth_token: Annotated[str, Header(min_length=1, alias="x-auth-token")],
) -> DjiDeviceTopologyResponse:
    """DJI Pilot 2 first-connection topology endpoint.

    Official DJI docs:
    https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/https/situation-awareness/obtain-device-topology-list.html
    The MVP returns an empty topology until real Pilot 2 hardware registers
    controller/drone serials and confirmed device_model enum values.
    """
    _ = (workspace_id, x_auth_token)
    return DjiDeviceTopologyResponse()
