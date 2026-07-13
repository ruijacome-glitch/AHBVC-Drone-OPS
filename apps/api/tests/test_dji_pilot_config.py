from uuid import UUID

from fastapi.testclient import TestClient

from app.api.dependencies.auth import AuthenticatedUser, current_user
from app.core.config import settings
from app.main import app


TEST_PILOT = AuthenticatedUser(
    id=UUID("00000000-0000-0000-0000-000000000001"),
    organisation_id=None,
    email="pilot@example.org",
    full_name="Test Pilot",
    roles=frozenset({"Piloto"}),
)


def authenticated_client() -> TestClient:
    async def override_current_user() -> AuthenticatedUser:
        return TEST_PILOT

    app.dependency_overrides[current_user] = override_current_user
    return TestClient(app)


def test_pilot_jsbridge_config_reports_missing_configuration() -> None:
    client = authenticated_client()
    try:
        response = client.get("/api/v1/dji/pilot/jsbridge-config")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["setup_ready"] is False
    assert payload["missing_config"]
    assert payload["ws_host"] is None


def test_pilot_jsbridge_config_includes_situation_awareness_websocket() -> None:
    client = authenticated_client()
    previous_values = {
        "dji_app_id": settings.dji_app_id,
        "dji_app_key": settings.dji_app_key,
        "dji_app_basic_license": settings.dji_app_basic_license,
        "dji_workspace_id": settings.dji_workspace_id,
        "dji_pilot_api_token": settings.dji_pilot_api_token,
        "mqtt_pilot_username": settings.mqtt_pilot_username,
        "mqtt_pilot_password": settings.mqtt_pilot_password,
        "mqtt_public_url": settings.mqtt_public_url,
    }

    settings.dji_app_id = "app-id"
    settings.dji_app_key = "app-key"
    settings.dji_app_basic_license = "license"
    settings.dji_workspace_id = "162d4348-fe24-49ac-a27e-9ec36bd46a80"
    settings.dji_pilot_api_token = "test-token"
    settings.mqtt_pilot_username = "pilot"
    settings.mqtt_pilot_password = "mqtt-password"
    settings.mqtt_public_url = "tcp://mqtt.uas.ahbvc.org.pt:1883"

    try:
        response = client.get("/api/v1/dji/pilot/jsbridge-config")
        assert response.status_code == 200
        payload = response.json()
        assert payload["setup_ready"] is True
        assert payload["mqtt_url"] == "tcp://mqtt.uas.ahbvc.org.pt:1883"
        assert payload["platform_name"] == settings.platform_name
        assert payload["ws_host"].startswith(
            "wss://api.uas.ahbvc.org.pt/manage/api/v1/workspaces/"
        )
        assert "x-auth-token" not in payload["ws_host"]
    finally:
        app.dependency_overrides.clear()
        for key, value in previous_values.items():
            setattr(settings, key, value)


def test_pilot_jsbridge_config_requires_human_authentication() -> None:
    client = TestClient(app)
    response = client.get("/api/v1/dji/pilot/jsbridge-config")
    assert response.status_code == 401
