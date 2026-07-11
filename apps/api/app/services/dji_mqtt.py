from __future__ import annotations

import json
import logging
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import paho.mqtt.client as mqtt

from app.core.config import settings

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


class DjiMqttConsumer:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._state = DjiMqttState()
        self._client: mqtt.Client | None = None

    def start(self) -> None:
        if not settings.mqtt_pilot_username or not settings.mqtt_pilot_password:
            logger.warning("DJI MQTT consumer disabled: credentials are not configured")
            return

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
