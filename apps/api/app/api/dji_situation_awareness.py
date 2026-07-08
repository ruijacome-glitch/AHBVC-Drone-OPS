from secrets import compare_digest

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status

from app.core.config import settings

router = APIRouter(tags=["dji-situation-awareness"])


def _is_authorized(token: str | None) -> bool:
    expected_token = settings.dji_pilot_api_token
    return bool(expected_token and token and compare_digest(token, expected_token))


@router.websocket("/manage/api/v1/workspaces/{workspace_id}/websocket")
async def dji_situation_awareness_websocket(
    websocket: WebSocket,
    workspace_id: str,
) -> None:
    """Minimal DJI Pilot 2 Situation Awareness WebSocket.

    TODO(DJI Cloud API): emit official device_osd, device_online,
    device_offline and device_update_topo payloads only after validating the
    exact message schema with the DJI Cloud API documentation and real hardware.
    """
    token = websocket.query_params.get("x-auth-token") or websocket.query_params.get("token")
    if not _is_authorized(token):
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await websocket.accept()
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        return
    finally:
        _ = workspace_id
