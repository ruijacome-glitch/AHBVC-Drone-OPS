from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.dji_pilot_to_cloud import router as dji_pilot_to_cloud_router
from app.api.dji_situation_awareness import router as dji_situation_awareness_router
from app.api.v1.router import api_router
from app.core.config import settings
from app.core.logging import configure_logging
from app.health.router import router as health_router


configure_logging()

app = FastAPI(
    title="UAS Platform API",
    version="0.1.0",
    description="Backend for AHBVC DJI Enterprise UAS operations.",
    openapi_url="/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(api_router, prefix="/api/v1")
app.include_router(dji_pilot_to_cloud_router)
app.include_router(dji_situation_awareness_router)
