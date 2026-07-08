import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.core.config import settings
from app.main import app


def test_situation_awareness_websocket_accepts_valid_token() -> None:
    client = TestClient(app)
    previous_token = settings.dji_pilot_api_token
    settings.dji_pilot_api_token = "test-token"

    try:
        with client.websocket_connect(
            "/manage/api/v1/workspaces/test-workspace/websocket?x-auth-token=test-token"
        ) as websocket:
            websocket.send_text("ping")
    finally:
        settings.dji_pilot_api_token = previous_token


def test_situation_awareness_websocket_rejects_invalid_token() -> None:
    client = TestClient(app)
    previous_token = settings.dji_pilot_api_token
    settings.dji_pilot_api_token = "test-token"

    try:
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect(
                "/manage/api/v1/workspaces/test-workspace/websocket?x-auth-token=wrong-token"
            ):
                pass
    finally:
        settings.dji_pilot_api_token = previous_token
