from fastapi import APIRouter

router = APIRouter()


@router.get("/status")
async def fleet_status() -> dict[str, object]:
    return {
        "max_simultaneous_drones": 2,
        "online_drones": [],
        "offline_drones": [],
        "supported_models": ["DJI Matrice 30T", "DJI Matrice 4T"],
    }

