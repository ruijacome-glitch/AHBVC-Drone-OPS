from __future__ import annotations

import json
import logging
import asyncio
import threading
from concurrent.futures import Future
from uuid import uuid4
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import paho.mqtt.client as mqtt

from app.core.config import settings
from app.db.session import AsyncSessionLocal
from app.services.dji_telemetry import normalize_osd
from sqlalchemy import text

logger = logging.getLogger(__name__)


DJI_MQTT_TOPICS = (
    "thing/product/+/osd",
    "thing/product/+/state",
    "thing/product/+/events",
    "thing/product/+/requests",
    "thing/product/+/services",
    "thing/product/+/property/set_reply",
    "thing/product/+/events_reply",
    "thing/product/+/requests_reply",
    "sys/product/+/network/probe",
    "sys/product/+/status",
    "sys/product/+/status_reply",
)


@dataclass
class DeviceMqttState:
    sn: str
    gateway_sn: str | None = None
    model: dict[str, str] | None = None
    online_status: bool | None = None
    last_topic: str | None = None
    last_payload: dict[str, Any] | None = None
    last_message_at: datetime | None = None
    message_count: int = 0


@dataclass
class DjiMqttState:
    connected: bool = False
    last_error: str | None = None
    last_connected_at: datetime | None = None
    devices: dict[str, DeviceMqttState] = field(default_factory=dict)
    live_capacities: dict[str, dict[str, Any]] = field(default_factory=dict)


class DjiMqttConsumer:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._state = DjiMqttState()
        self._client: mqtt.Client | None = None
        self._async_loop: asyncio.AbstractEventLoop | None = None

    def start(self) -> None:
        if not settings.mqtt_pilot_username or not settings.mqtt_pilot_password:
            logger.warning("DJI MQTT consumer disabled: credentials are not configured")
            return

        try:
            self._async_loop = asyncio.get_running_loop()
        except RuntimeError:
            self._async_loop = None
            logger.error("DJI MQTT consumer started without an application event loop")

        self._client = mqtt.Client(
            callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
            client_id="uas-platform-cloud-consumer",
            protocol=mqtt.MQTTv5,
        )
        self._client.username_pw_set(settings.mqtt_pilot_username, settings.mqtt_pilot_password)
        self._client.on_connect = self._on_connect
        self._client.on_disconnect = self._on_disconnect
        self._client.on_message = self._on_message
        try:
            self._client.connect(settings.mqtt_internal_host, settings.mqtt_internal_port, keepalive=30)
            self._client.loop_start()
        except Exception as exc:
            self._set_error(str(exc))
            logger.exception("Unable to start DJI MQTT consumer")

    def stop(self) -> None:
        client, self._client = self._client, None
        if client is None:
            return
        client.loop_stop()
        client.disconnect()
        self._async_loop = None
        with self._lock:
            self._state.connected = False

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return {
                "connected": self._state.connected,
                "last_error": self._state.last_error,
                "last_connected_at": self._state.last_connected_at.isoformat()
                if self._state.last_connected_at
                else None,
                "devices": {
                    sn: {
                        "sn": device.sn,
                        "gateway_sn": device.gateway_sn,
                        "model": device.model,
                        "online_status": device.online_status,
                        "last_topic": device.last_topic,
                        "last_message_at": device.last_message_at.isoformat()
                        if device.last_message_at
                        else None,
                        "message_count": device.message_count,
                    }
                    for sn, device in self._state.devices.items()
                },
            }

    def livestream_options(self) -> list[dict[str, Any]]:
        """Return DJI-advertised video sources without exposing device secrets."""
        with self._lock:
            options: list[dict[str, Any]] = []
            for gateway_sn, capacity in self._state.live_capacities.items():
                for device in capacity.get("device_list", []):
                    aircraft_sn = device.get("sn")
                    if not isinstance(aircraft_sn, str):
                        continue
                    for camera in device.get("camera_list", []):
                        camera_index = camera.get("camera_index")
                        if not isinstance(camera_index, str):
                            continue
                        for video in camera.get("video_list", []):
                            video_index = video.get("video_index")
                            if not isinstance(video_index, str):
                                continue
                            options.append(
                                {
                                    "gateway_sn": gateway_sn,
                                    "aircraft_sn": aircraft_sn,
                                    "camera_index": camera_index,
                                    "video_index": video_index,
                                    "video_type": video.get("video_type", "unknown"),
                                    "video_id": f"{aircraft_sn}/{camera_index}/{video_index}",
                                }
                            )
            return options

    def publish_service(self, gateway_sn: str, method: str, data: dict[str, Any]) -> dict[str, str]:
        """Publish an official DJI service envelope to a gateway."""
        client = self._client
        if client is None or not self._state.connected:
            raise RuntimeError("DJI MQTT consumer is not connected")
        tid = str(uuid4())
        bid = str(uuid4())
        payload = {
            "tid": tid,
            "bid": bid,
            "timestamp": int(datetime.now(timezone.utc).timestamp() * 1000),
            "method": method,
            "data": data,
        }
        topic = f"thing/product/{gateway_sn}/services"
        result = client.publish(topic, json.dumps(payload), qos=1)
        if result.rc != mqtt.MQTT_ERR_SUCCESS:
            raise RuntimeError(f"Unable to publish DJI service: {result.rc}")
        logger.info("Published DJI service %s to gateway %s", method, gateway_sn)
        return {"topic": topic, "tid": tid, "bid": bid}

    def _on_connect(
        self,
        client: mqtt.Client,
        userdata: Any,
        flags: mqtt.ConnectFlags,
        reason_code: mqtt.ReasonCode,
        properties: mqtt.Properties | None = None,
    ) -> None:
        if getattr(reason_code, "value", reason_code) != mqtt.MQTT_ERR_SUCCESS:
            self._set_error(str(reason_code))
            return
        for topic in DJI_MQTT_TOPICS:
            client.subscribe(topic, qos=1)
        with self._lock:
            self._state.connected = True
            self._state.last_error = None
            self._state.last_connected_at = datetime.now(timezone.utc)
        logger.info("DJI MQTT consumer connected and subscribed to %d topic patterns", len(DJI_MQTT_TOPICS))

    def _on_disconnect(
        self,
        client: mqtt.Client,
        userdata: Any,
        disconnect_flags: mqtt.DisconnectFlags,
        reason_code: mqtt.ReasonCode,
        properties: mqtt.Properties | None = None,
    ) -> None:
        with self._lock:
            self._state.connected = False
        if getattr(reason_code, "value", reason_code) != mqtt.MQTT_ERR_SUCCESS:
            self._set_error(str(reason_code))
            logger.warning("DJI MQTT consumer disconnected: %s", reason_code)

    def _on_message(self, client: mqtt.Client, userdata: Any, message: mqtt.MQTTMessage) -> None:
        parts = message.topic.split("/")
        sn = parts[2] if len(parts) >= 3 else "unknown"
        try:
            payload = json.loads(message.payload.decode("utf-8"))
            if not isinstance(payload, dict):
                payload = {"value": payload}
        except (UnicodeDecodeError, json.JSONDecodeError):
            logger.warning("Ignoring non-JSON DJI MQTT payload on %s", message.topic)
            return

        now = datetime.now(timezone.utc)
        with self._lock:
            device = self._state.devices.setdefault(sn, DeviceMqttState(sn=sn))
            device.last_topic = message.topic
            device.last_payload = payload
            device.last_message_at = now
            device.message_count += 1

            if parts[:2] == ["sys", "product"] and len(parts) >= 4 and parts[3] == "status":
                self._apply_topology_update(sn, payload, now)
            elif parts[:2] == ["thing", "product"] and len(parts) >= 4 and parts[3] == "osd":
                self._persist_osd_message(sn, payload, message.topic)

            data = payload.get("data")
            if isinstance(data, dict) and isinstance(data.get("live_capacity"), dict):
                self._state.live_capacities[sn] = data["live_capacity"]

        if parts[:2] == ["sys", "product"] and len(parts) >= 4 and parts[3] == "status":
            self._publish_status_reply(client, message.topic, payload)

    def _publish_status_reply(
        self,
        client: mqtt.Client | None,
        topic: str,
        payload: dict[str, Any],
    ) -> None:
        if client is None or not payload.get("tid") or not payload.get("bid"):
            return
        reply = {
            "tid": payload["tid"],
            "bid": payload["bid"],
            "method": payload.get("method"),
            "data": {"result": 0},
            "timestamp": int(datetime.now(timezone.utc).timestamp() * 1000),
        }
        reply_topic = f"{topic}_reply"
        result = client.publish(reply_topic, json.dumps(reply), qos=1)
        if result.rc != mqtt.MQTT_ERR_SUCCESS:
            logger.warning("Unable to publish DJI status reply on %s: %s", reply_topic, result.rc)

    def _persist_osd_message(self, device_sn: str, payload: dict[str, Any], topic: str) -> None:
        gateway_sn = payload.get("gateway")
        with self._lock:
            device_state = self._state.devices.get(device_sn)
            known_gateway_sn = device_state.gateway_sn if device_state else None
        # The RC Plus publishes its own OSD too; flight telemetry belongs to
        # a child aircraft registered through update_topo.
        if not known_gateway_sn:
            return
        if not isinstance(gateway_sn, str):
            gateway_sn = known_gateway_sn
        if not gateway_sn:
            logger.warning("Ignoring DJI OSD without gateway SN: %s", topic)
            return
        model = None
        with self._lock:
            model_data = self._state.devices.get(device_sn)
            if model_data and model_data.model:
                model = "-".join(model_data.model.get(key, "") for key in ("domain", "type", "sub_type"))
        telemetry = normalize_osd(device_sn, gateway_sn, payload, model)
        self._schedule_telemetry_insert(telemetry, topic, payload, device_sn)

    def _schedule_telemetry_insert(
        self,
        telemetry: Any,
        topic: str,
        payload: dict[str, Any],
        device_sn: str,
    ) -> None:
        loop = self._async_loop
        if loop is None or loop.is_closed():
            logger.warning("Skipping DJI telemetry persistence: application event loop unavailable")
            return
        future = asyncio.run_coroutine_threadsafe(
            self._insert_telemetry(telemetry, topic, payload),
            loop,
        )
        future.add_done_callback(
            lambda completed: self._log_telemetry_insert_result(completed, device_sn)
        )

    @staticmethod
    def _log_telemetry_insert_result(future: Future[None], device_sn: str) -> None:
        try:
            future.result()
        except Exception:
            logger.exception("Unable to persist DJI OSD telemetry for %s", device_sn)

    async def _insert_telemetry(self, telemetry: Any, topic: str, payload: dict[str, Any]) -> None:
        async with AsyncSessionLocal() as session:
            await session.execute(
                text(
                    """
                    INSERT INTO controllers (gateway_sn, callsign, online_status, last_seen_at)
                    VALUES (:gateway_sn, :callsign, 'online', :observed_at)
                    ON CONFLICT (gateway_sn) DO UPDATE SET
                      online_status = 'online', last_seen_at = EXCLUDED.last_seen_at
                    """
                ),
                {"gateway_sn": telemetry.gateway_serial, "callsign": settings.dji_gateway_callsign,
                 "observed_at": telemetry.observed_at},
            )
            await session.execute(
                text(
                    """
                    INSERT INTO drones (controller_id, serial_number, model, online_status, last_seen_at)
                    SELECT id, :drone_serial, COALESCE(:model, :default_model), 'online', :observed_at
                    FROM controllers WHERE gateway_sn = :gateway_sn
                    ON CONFLICT (serial_number) DO UPDATE SET
                      controller_id = EXCLUDED.controller_id, model = EXCLUDED.model,
                      online_status = 'online', last_seen_at = EXCLUDED.last_seen_at
                    """
                ),
                {"drone_serial": telemetry.drone_serial, "gateway_sn": telemetry.gateway_serial,
                 "model": telemetry.model, "default_model": settings.dji_aircraft_callsign,
                 "observed_at": telemetry.observed_at},
            )
            await session.execute(
                text(
                    """
                    INSERT INTO telemetry_points (
                      drone_id, controller_id, drone_serial, gateway_serial, model, position,
                      altitude_m, speed_mps, heading_deg, pitch_deg, roll_deg, yaw_deg,
                      battery_percent, gps_status, rtk_status, active_payload, flight_mode,
                      link_quality, source_topic, payload, observed_at
                    )
                    SELECT d.id, c.id, :drone_serial, :gateway_serial, :model,
                      CASE WHEN :longitude BETWEEN -180 AND 180 AND :latitude BETWEEN -90 AND 90
                        AND (:latitude <> 0 OR :longitude <> 0)
                        THEN ST_SetSRID(ST_MakePoint(:longitude, :latitude), 4326)::geography END,
                      :altitude_m, :speed_mps, :heading_deg, :pitch_deg, :roll_deg, :yaw_deg,
                      :battery_percent, :gps_status, :rtk_status, :active_payload, :flight_mode,
                      :link_quality, :source_topic, CAST(:payload AS jsonb), :observed_at
                    FROM drones d JOIN controllers c ON c.gateway_sn = :gateway_serial
                    WHERE d.serial_number = :drone_serial
                    """
                ),
                {**telemetry.__dict__, "longitude": telemetry.longitude, "latitude": telemetry.latitude,
                 "source_topic": topic, "payload": json.dumps(payload)},
            )
            if telemetry.latitude is not None and telemetry.longitude is not None and (
                telemetry.latitude != 0 or telemetry.longitude != 0
            ):
                active_track = await session.execute(
                    text(
                        """
                        SELECT ft.id FROM flight_tracks ft
                        JOIN drones d ON d.id = ft.drone_id
                        WHERE d.serial_number = :drone_serial AND ft.ended_at IS NULL
                        ORDER BY ft.started_at DESC LIMIT 1
                        """
                    ),
                    {"drone_serial": telemetry.drone_serial},
                )
                track_id = active_track.scalar_one_or_none()
                if track_id is None:
                    await session.execute(
                        text(
                            """
                            INSERT INTO flight_tracks (drone_id, track, started_at)
                            SELECT id, ST_MakeLine(
                              ST_Force3D(ST_SetSRID(ST_MakePoint(:longitude, :latitude, :altitude_m), 4326)),
                              ST_Force3D(ST_SetSRID(ST_MakePoint(:longitude, :latitude, :altitude_m), 4326))
                            ), :observed_at
                            FROM drones WHERE serial_number = :drone_serial
                            """
                        ),
                        {"drone_serial": telemetry.drone_serial, "longitude": telemetry.longitude,
                         "latitude": telemetry.latitude, "altitude_m": telemetry.altitude_m or 0,
                         "observed_at": telemetry.observed_at},
                    )
                else:
                    await session.execute(
                        text(
                            """
                            UPDATE flight_tracks SET
                              track = ST_AddPoint(track, ST_Force3D(
                                ST_SetSRID(ST_MakePoint(:longitude, :latitude, :altitude_m), 4326)
                              ))
                            WHERE id = :track_id
                            """
                        ),
                        {"track_id": track_id, "longitude": telemetry.longitude,
                         "latitude": telemetry.latitude, "altitude_m": telemetry.altitude_m or 0,
                         "observed_at": telemetry.observed_at},
                    )
            await session.commit()

    def _apply_topology_update(
        self,
        gateway_sn: str,
        payload: dict[str, Any],
        timestamp: datetime,
    ) -> None:
        if payload.get("method") != "update_topo":
            return
        data = payload.get("data")
        if not isinstance(data, dict):
            return
        for sub_device in data.get("sub_devices", []):
            if not isinstance(sub_device, dict) or not isinstance(sub_device.get("sn"), str):
                continue
            sn = sub_device["sn"]
            device = self._state.devices.setdefault(sn, DeviceMqttState(sn=sn))
            device.gateway_sn = gateway_sn
            device.model = {
                key: str(sub_device[key])
                for key in ("domain", "type", "sub_type", "thing_version")
                if key in sub_device
            }
            device.online_status = True
            device.last_topic = f"sys/product/{gateway_sn}/status"
            device.last_message_at = timestamp
            # Device secrets and nonces are deliberately never retained or exposed.
            device.last_payload = {"method": "update_topo", "gateway": gateway_sn}

    def _set_error(self, error: str) -> None:
        with self._lock:
            self._state.last_error = error


dji_mqtt_consumer = DjiMqttConsumer()
