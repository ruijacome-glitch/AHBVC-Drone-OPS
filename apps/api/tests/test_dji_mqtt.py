import json
from types import SimpleNamespace

from app.services.dji_mqtt import DjiMqttConsumer


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
