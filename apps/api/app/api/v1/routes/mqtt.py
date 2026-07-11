from fastapi import APIRouter, HTTPException, Path, Query
from sqlalchemy import text
from datetime import datetime
from decimal import Decimal

from app.db.session import AsyncSessionLocal

from app.services.dji_mqtt import dji_mqtt_consumer

router = APIRouter(prefix="/dji/mqtt", tags=["dji-mqtt"])


def _json_telemetry(row: object) -> dict[str, object]:
    values = dict(row)  # type: ignore[arg-type]
    return {
        key: float(value)
        if isinstance(value, Decimal)
        else value.isoformat().replace("+00:00", "Z")
        if isinstance(value, datetime)
        else value
        for key, value in values.items()
    }


@router.get("/status")
async def mqtt_status() -> dict[str, object]:
    """Runtime diagnostics for the internal DJI MQTT consumer."""
    return dji_mqtt_consumer.snapshot()


@router.get("/telemetry/{drone_sn}/latest")
async def latest_telemetry(
    drone_sn: str = Path(pattern=r"^[A-Za-z0-9_-]{1,64}$"),
) -> dict[str, object]:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            text(
                """
                SELECT drone_serial, gateway_serial, model, ST_Y(position::geometry) AS latitude,
                       ST_X(position::geometry) AS longitude, altitude_m, speed_mps, heading_deg,
                       pitch_deg, roll_deg, yaw_deg, battery_percent, gps_status, rtk_status,
                       active_payload, flight_mode, link_quality, source_topic, observed_at
                FROM telemetry_points
                WHERE drone_serial = :drone_sn
                ORDER BY observed_at DESC
                LIMIT 1
                """
            ),
            {"drone_sn": drone_sn},
        )
        row = result.mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="No telemetry available for this drone")
    return _json_telemetry(row)


@router.get("/telemetry/{drone_sn}/history")
async def telemetry_history(
    drone_sn: str = Path(pattern=r"^[A-Za-z0-9_-]{1,64}$"),
    limit: int = Query(default=100, ge=1, le=1000),
) -> list[dict[str, object]]:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            text(
                """
                SELECT drone_serial, gateway_serial, model, ST_Y(position::geometry) AS latitude,
                       ST_X(position::geometry) AS longitude, altitude_m, speed_mps, heading_deg,
                       pitch_deg, roll_deg, yaw_deg, battery_percent, gps_status, rtk_status,
                       active_payload, flight_mode, link_quality, observed_at
                FROM telemetry_points
                WHERE drone_serial = :drone_sn
                ORDER BY observed_at DESC
                LIMIT :limit
                """
            ),
            {"drone_sn": drone_sn, "limit": limit},
        )
        return [_json_telemetry(row) for row in result.mappings().all()]


@router.get("/telemetry/{drone_sn}/track")
async def latest_flight_track(
    drone_sn: str = Path(pattern=r"^[A-Za-z0-9_-]{1,64}$"),
) -> dict[str, object]:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            text(
                """
                SELECT ST_AsGeoJSON(ft.track)::json AS geometry,
                       ft.started_at, ft.ended_at
                FROM flight_tracks ft
                JOIN drones d ON d.id = ft.drone_id
                WHERE d.serial_number = :drone_sn
                ORDER BY ft.started_at DESC
                LIMIT 1
                """
            ),
            {"drone_sn": drone_sn},
        )
        row = result.mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="No flight track available for this drone")
    return _json_telemetry(row)
