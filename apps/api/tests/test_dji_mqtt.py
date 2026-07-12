import asyncio
import json
from types import SimpleNamespace

from app.services.dji_mqtt import DJI_MQTT_TOPICS, DjiMqttConsumer
from app.services.dji_telemetry import normalize_osd


class _PublishResult:
    rc = 0


class _FakeMqttClient:
    def __init__(self) -> None:
        self.published: list[tuple[str, str, int]] = []

    def publish(self, topic: str, payload: str, qos: int) -> _PublishResult:
        self.published.append((topic, payload, qos))
        return _PublishResult()


def test_mqtt_consumer_subscribes_to_official_status_topics() -> None:
    assert "sys/product/+/status" in DJI_MQTT_TOPICS
    assert "thing/product/+/requests" in DJI_MQTT_TOPICS


def test_mqtt_consumer_acknowledges_topology_update() -> None:
    consumer = DjiMqttConsumer()
    client = _FakeMqttClient()
    message = SimpleNamespace(
        topic="sys/product/gateway-123/status",
        payload=json.dumps(
            {
                "tid": "tid-1",
                "bid": "bid-1",
                "method": "update_topo",
                "data": {"sub_devices": []},
            }
        ).encode(),
    )

    consumer._on_message(client, None, message)  # noqa: SLF001

    assert len(client.published) == 1
    topic, raw_payload, qos = client.published[0]
    assert topic == "sys/product/gateway-123/status_reply"
    assert qos == 1
    reply = json.loads(raw_payload)
    assert reply["tid"] == "tid-1"
    assert reply["bid"] == "bid-1"
    assert reply["method"] == "update_topo"
    assert reply["data"] == {"result": 0}


def test_mqtt_consumer_records_json_message() -> None:
    consumer = DjiMqttConsumer()
    message = SimpleNamespace(
        topic="thing/product/aircraft-123/osd",
        payload=json.dumps({"data": {"latitude": 38.7}}).encode(),
    )

    consumer._on_message(None, None, message)  # noqa: SLF001

    snapshot = consumer.snapshot()
    assert snapshot["connected"] is False
    assert snapshot["devices"]["aircraft-123"]["last_topic"].endswith("/osd")
    assert snapshot["devices"]["aircraft-123"]["message_count"] == 1


def test_mqtt_consumer_exposes_official_livestream_options() -> None:
    consumer = DjiMqttConsumer()
    message = SimpleNamespace(
        topic="thing/product/gateway-123/state",
        payload=json.dumps(
            {
                "data": {
                    "live_capacity": {
                        "device_list": [
                            {
                                "sn": "aircraft-123",
                                "camera_list": [
                                    {
                                        "camera_index": "53-0-0",
                                        "video_list": [
                                            {"video_index": "wide-0", "video_type": "wide"},
                                            {"video_index": "thermal-0", "video_type": "thermal"},
                                        ],
                                    }
                                ],
                            }
                        ]
                    }
                }
            }
        ).encode(),
    )

    consumer._on_message(None, None, message)  # noqa: SLF001

    assert consumer.livestream_options() == [
        {
            "gateway_sn": "gateway-123",
            "aircraft_sn": "aircraft-123",
            "camera_index": "53-0-0",
            "video_index": "wide-0",
            "video_type": "wide",
            "video_id": "aircraft-123/53-0-0/wide-0",
        },
        {
            "gateway_sn": "gateway-123",
            "aircraft_sn": "aircraft-123",
            "camera_index": "53-0-0",
            "video_index": "thermal-0",
            "video_type": "thermal",
            "video_id": "aircraft-123/53-0-0/thermal-0",
        },
    ]


def test_normalize_matrice_30t_osd_preserves_thermal_and_navigation_data() -> None:
    telemetry = normalize_osd(
        "aircraft-123",
        "gateway-123",
        {
            "timestamp": 1783809012075,
            "gateway": "gateway-123",
            "data": {
                "height": 63.8,
                "attitude_head": 48.6,
                "battery": {"capacity_percent": 55},
                "position_state": {"gps_number": 4, "quality": 0, "rtk_number": 9},
                "cameras": [{"payload_index": "53-0-0"}],
                "53-0-0": {"thermal_global_temperature_max": 28.16},
            },
        },
        "0-67-1",
    )

    assert telemetry.altitude_m == 63.8
    assert telemetry.heading_deg == 48.6
    assert telemetry.battery_percent == 55
    assert telemetry.active_payload == "53-0-0"
    assert telemetry.gps_status == "gps_number=4;quality=0"
    assert telemetry.rtk_status == "rtk_number=9;is_fixed=None"


def test_mqtt_consumer_ignores_invalid_json() -> None:
    consumer = DjiMqttConsumer()
    message = SimpleNamespace(topic="thing/product/aircraft-123/osd", payload=b"invalid")

    consumer._on_message(None, None, message)  # noqa: SLF001

    assert consumer.snapshot()["devices"] == {}


def test_mqtt_consumer_registers_subdevice_from_update_topo() -> None:
    consumer = DjiMqttConsumer()
    message = SimpleNamespace(
        topic="sys/product/gateway-123/status",
        payload=json.dumps(
            {
                "method": "update_topo",
                "data": {
                    "sub_devices": [
                        {
                            "sn": "aircraft-123",
                            "domain": "0",
                            "type": "67",
                            "sub_type": "1",
                            "device_secret": "must-not-be-exposed",
                        }
                    ]
                },
            }
        ).encode(),
    )

    consumer._on_message(None, None, message)  # noqa: SLF001

    aircraft = consumer.snapshot()["devices"]["aircraft-123"]
    assert aircraft["gateway_sn"] == "gateway-123"
    assert aircraft["online_status"] is True
    assert aircraft["model"] == {"domain": "0", "type": "67", "sub_type": "1"}
    assert "device_secret" not in str(aircraft)


def test_telemetry_insert_is_scheduled_on_api_event_loop(monkeypatch) -> None:
    consumer = DjiMqttConsumer()
    class _ApiLoop:
        @staticmethod
        def is_closed() -> bool:
            return False

    api_loop = _ApiLoop()
    consumer._async_loop = api_loop  # type: ignore[assignment]  # noqa: SLF001
    scheduled: dict[str, object] = {}

    class _ScheduledFuture:
        def add_done_callback(self, callback) -> None:
            scheduled["callback"] = callback

    def fake_run_coroutine_threadsafe(coroutine, loop):
        scheduled["loop"] = loop
        coroutine.close()
        return _ScheduledFuture()

    monkeypatch.setattr(asyncio, "run_coroutine_threadsafe", fake_run_coroutine_threadsafe)

    consumer._schedule_telemetry_insert(  # noqa: SLF001
        SimpleNamespace(),
        "thing/product/aircraft-123/osd",
        {"data": {}},
        "aircraft-123",
    )

    assert scheduled["loop"] is api_loop
    assert "callback" in scheduled
