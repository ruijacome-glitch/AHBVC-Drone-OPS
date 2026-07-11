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
