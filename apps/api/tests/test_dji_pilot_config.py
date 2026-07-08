from fastapi.testclient import TestClient

from app.main import app


def test_pilot_jsbridge_config_reports_missing_configuration() -> None:
    client = TestClient(app)

    response = client.get("/api/v1/dji/pilot/jsbridge-config")

    assert response.status_code == 200
    payload = response.json()
    assert payload["setup_ready"] is False
    assert "DJI_APP_ID" in payload["missing_config"]
    assert payload["ws_host"] is None
