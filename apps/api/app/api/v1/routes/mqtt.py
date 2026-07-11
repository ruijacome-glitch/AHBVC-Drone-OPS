from fastapi import APIRouter

from app.services.dji_mqtt import dji_mqtt_consumer

router = APIRouter(prefix="/dji/mqtt", tags=["dji-mqtt"])


@router.get("/status")
async def mqtt_status() -> dict[str, object]:
    """Runtime diagnostics for the internal DJI MQTT consumer."""
    return dji_mqtt_consumer.snapshot()
