from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app


def test_pilot_jsbridge_config_reports_missing_configuration() -> None:
    client = TestClient(app)
    previous_token = settings.dji_pilot_setup_token
    settings.dji_pilot_setup_token = "setup-token"

    try:
        response = client.get(
            "/api/v1/dji/pilot/jsbridge-config",
            headers={"x-pilot-setup-token": "setup-token"},
        )
    finally:
        settings.dji_pilot_setup_token = previous_token

    assert response.status_code == 200
    payload = response.json()
    assert payload["setup_ready"] is False
    assert payload["missing_config"]
    assert payload["ws_host"] is None


def test_pilot_jsbridge_config_includes_situation_awareness_websocket() -> None:
    client = TestClient(app)
    previous_values = {
        "dji_app_id": settings.dji_app_id,
        "dji_app_key": settings.dji_app_key,
        "dji_app_basic_license": settings.dji_app_basic_license,
        "dji_workspace_id": settings.dji_workspace_id,
        "dji_pilot_api_token": settings.dji_pilot_api_token,
        "dji_pilot_setup_token": settings.dji_pilot_setup_token,
        "mqtt_pilot_username": settings.mqtt_pilot_username,
        "mqtt_pilot_password": settings.mqtt_pilot_password,
        "mqtt_public_url": settings.mqtt_public_url,
    }

    settings.dji_app_id = "app-id"
    settings.dji_app_key = "app-key"
    settings.dji_app_basic_license = "license"
    settings.dji_workspace_id = "162d4348-fe24-49ac-a27e-9ec36bd46a80"
    settings.dji_pilot_api_token = "test-token"
    settings.dji_pilot_setup_token = "setup-token"
    settings.mqtt_pilot_username = "pilot"
    settings.mqtt_pilot_password = "mqtt-password"
    settings.mqtt_public_url = "tcp://mqtt.uas.ahbvc.org.pt:1883"

    try:
        response = client.get(
            "/api/v1/dji/pilot/jsbridge-config",
            headers={"x-pilot-setup-token": "setup-token"},
        )

        assert response.status_code == 200
        payload = response.json()
        assert payload["setup_ready"] is True
        assert payload["mqtt_url"] == "tcp://mqtt.uas.ahbvc.org.pt:1883"
        assert payload["ws_host"].startswith(
            "wss://api.uas.ahbvc.org.pt/manage/api/v1/workspaces/"
        )
        assert "x-auth-token" not in payload["ws_host"]
    finally:
        for key, value in previous_values.items():
            setattr(settings, key, value)


def test_pilot_jsbridge_config_requires_setup_token() -> None:
    client = TestClient(app)
    previous_token = settings.dji_pilot_setup_token
    settings.dji_pilot_setup_token = "setup-token"
    try:
        response = client.get("/api/v1/dji/pilot/jsbridge-config")
        assert response.status_code == 401
    finally:
        settings.dji_pilot_setup_token = previous_token
