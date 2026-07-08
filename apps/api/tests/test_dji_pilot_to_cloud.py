from fastapi.testclient import TestClient

from app.main import app


def test_obtain_device_topology_list_returns_empty_topology() -> None:
    client = TestClient(app)

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


def test_obtain_device_topology_list_requires_auth_token_header() -> None:
    client = TestClient(app)

    response = client.get("/manage/api/v1/workspaces/test-workspace/devices/topologies")

    assert response.status_code == 422
