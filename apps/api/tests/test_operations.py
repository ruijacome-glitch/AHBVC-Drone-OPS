from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.api.v1.routes.operations import CreateMissionRequest, CreateOccurrenceRequest
from app.main import app


def test_occurrence_location_requires_coordinate_pair() -> None:
    with pytest.raises(ValidationError):
        CreateOccurrenceRequest(code="OC-1", title="Test occurrence", latitude=38.7)


def test_operational_mission_requires_occurrence() -> None:
    with pytest.raises(ValidationError):
        CreateMissionRequest(title="Reconnaissance", objective="Assess the incident area")


def test_training_mission_can_exist_without_occurrence() -> None:
    payload = CreateMissionRequest(
        title="Training flight",
        objective="Crew proficiency",
        is_training=True,
    )
    assert payload.occurrence_id is None


def test_operations_endpoints_require_authentication() -> None:
    client = TestClient(app)
    assert client.get("/api/v1/operations/occurrences").status_code == 401
    assert client.get("/api/v1/operations/missions").status_code == 401
    assert client.get(f"/api/v1/operations/missions/{uuid4()}/flights").status_code == 401
