from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from app.services.pdf_reports import template_environment


def test_mission_report_template_escapes_untrusted_values() -> None:
    html = template_environment.get_template("mission_report.html").render(
        logo_available=False,
        report={
            "mission_id": uuid4(),
            "status": "closed",
            "occurrence_code": "OC-1",
            "occurrence_title": "<script>alert(1)</script>",
            "pilot_name": "Test Pilot",
            "drone_serial": "DRONE-1",
            "controller_serial": "RC-1",
            "started_at": None,
            "ended_at": None,
            "telemetry_points": 0,
            "max_altitude_m": None,
            "max_speed_mps": None,
            "min_battery_percent": None,
            "generated_at": "2026-07-12T12:00:00Z",
        },
    )
    assert "<script>" not in html
    assert "&lt;script&gt;" in html


def test_generate_report_requires_authentication() -> None:
    response = TestClient(app).post(f"/api/v1/reports/missions/{uuid4()}")
    assert response.status_code == 403
