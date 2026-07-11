from app.core.config import settings
from fastapi.testclient import TestClient

from app.main import app


def test_bind_device_matches_dji_demo_contract() -> None:
    original_workspace = settings.dji_workspace_id
    original_token = settings.dji_pilot_api_token
    settings.dji_workspace_id = "workspace-id"
    settings.dji_pilot_api_token = "test-token"
    try:
        with TestClient(app) as client:
            response = client.post(
                "/manage/api/v1/devices/gateway-123/binding",
                headers={"x-auth-token": "test-token"},
                json={
                    "device_sn": "gateway-123",
                    "user_id": "workspace-id",
                    "workspace_id": "workspace-id",
                },
            )
        assert response.status_code == 200
        assert response.json() == {"code": 0, "message": "success", "data": {}}
    finally:
        settings.dji_workspace_id = original_workspace
        settings.dji_pilot_api_token = original_token
