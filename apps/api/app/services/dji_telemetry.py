from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any


@dataclass(frozen=True)
class NormalizedTelemetry:
    drone_serial: str
    gateway_serial: str
    model: str | None
    latitude: float | None
    longitude: float | None
    altitude_m: float | None
    speed_mps: float | None
    heading_deg: float | None
    pitch_deg: float | None
    roll_deg: float | None
    yaw_deg: float | None
    battery_percent: float | None
    gps_status: str | None
    rtk_status: str | None
    active_payload: str | None
    flight_mode: str | None
    link_quality: str | None
    observed_at: datetime


def _number(value: Any) -> float | None:
    return float(value) if isinstance(value, (int, float)) else None


def normalize_osd(
    drone_serial: str,
    gateway_serial: str,
    payload: dict[str, Any],
    model: str | None = None,
) -> NormalizedTelemetry:
    data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    position = data.get("position_state") if isinstance(data.get("position_state"), dict) else {}
    batteries = data.get("battery") if isinstance(data.get("battery"), dict) else {}
    cameras = data.get("cameras") if isinstance(data.get("cameras"), list) else []
    first_camera = cameras[0] if cameras and isinstance(cameras[0], dict) else {}
    payload_keys = [key for key in data if key.count("-") == 2 and isinstance(data[key], dict)]
    payload_index = first_camera.get("payload_index") or (payload_keys[0] if payload_keys else None)

    timestamp = _number(payload.get("timestamp"))
    observed_at = (
        datetime.fromtimestamp(timestamp / 1000, tz=timezone.utc)
        if timestamp is not None
        else datetime.now(timezone.utc)
    )
    gps_status = None
    if "gps_number" in position or "quality" in position:
        gps_status = f"gps_number={position.get('gps_number')};quality={position.get('quality')}"
    rtk_status = None
    if "rtk_number" in position or "is_fixed" in position:
        rtk_status = f"rtk_number={position.get('rtk_number')};is_fixed={position.get('is_fixed')}"
    battery_percent = _number(batteries.get("capacity_percent"))
    if battery_percent is None:
        battery_percent = _number(data.get("capacity_percent"))

    return NormalizedTelemetry(
        drone_serial=drone_serial,
        gateway_serial=gateway_serial,
        model=model,
        latitude=_number(data.get("latitude")),
        longitude=_number(data.get("longitude")),
        altitude_m=_number(data.get("height")),
        speed_mps=_number(data.get("horizontal_speed")),
        heading_deg=_number(data.get("attitude_head")),
        pitch_deg=_number(data.get("attitude_pitch")),
        roll_deg=_number(data.get("attitude_roll")),
        yaw_deg=_number(data.get("yaw")),
        battery_percent=battery_percent,
        gps_status=gps_status,
        rtk_status=rtk_status,
        active_payload=str(payload_index) if payload_index is not None else None,
        flight_mode=str(data["mode_code"]) if "mode_code" in data else None,
        link_quality=None,
        observed_at=observed_at,
    )
