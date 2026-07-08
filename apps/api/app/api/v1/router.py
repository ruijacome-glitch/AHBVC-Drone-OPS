from fastapi import APIRouter

from app.api.v1.routes import dji, fleet, system

api_router = APIRouter()
api_router.include_router(system.router, prefix="/system", tags=["system"])
api_router.include_router(dji.router, prefix="/dji", tags=["dji-cloud-api"])
api_router.include_router(fleet.router, prefix="/fleet", tags=["fleet"])

