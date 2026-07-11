from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app


def test_obtain_device_topology_list_returns_empty_topology() -> None:
    client = TestClient(app)
    settings.dji_pilot_api_token = "test-token"

    response = client.get(
        "/manage/api/v1/workspaces/test-workspace/devices/topologies",
        headers={"x-auth-token": "test-token"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "code": 0,
        "message": "success",
        "data": {
            "list": [],
        },
    }


def test_obtain_device_topology_list_returns_configured_gateway() -> None:
    client = TestClient(app)
    previous_values = {
        "dji_pilot_api_token": settings.dji_pilot_api_token,
        "dji_workspace_id": settings.dji_workspace_id,
        "dji_gateway_sn": settings.dji_gateway_sn,
    }
    settings.dji_pilot_api_token = "test-token"
    settings.dji_workspace_id = "workspace-id"
    settings.dji_gateway_sn = "gateway-sn"

    try:
        response = client.get(
            "/manage/api/v1/workspaces/workspace-id/devices/topologies",
            headers={"x-auth-token": "test-token"},
        )

        assert response.status_code == 200
        payload = response.json()["data"]["list"]
        assert payload[0]["hosts"] == []
        assert payload[0]["parents"][0]["sn"] == "gateway-sn"
        assert payload[0]["parents"][0]["device_model"] == {
            "key": "2-119-0",
            "domain": "2",
            "type": "119",
            "sub_type": "0",
        }
    finally:
        for key, value in previous_values.items():
            setattr(settings, key, value)


def test_obtain_device_topology_list_rejects_invalid_auth_token() -> None:
    client = TestClient(app)
    settings.dji_pilot_api_token = "test-token"

    response = client.get(
        "/manage/api/v1/workspaces/test-workspace/devices/topologies",
        headers={"x-auth-token": "wrong-token"},
    )

    assert response.status_code == 401


def test_obtain_device_topology_list_requires_auth_token_header() -> None:
    client = TestClient(app)
    settings.dji_pilot_api_token = "test-token"

    response = client.get("/manage/api/v1/workspaces/test-workspace/devices/topologies")

    assert response.status_code == 422
