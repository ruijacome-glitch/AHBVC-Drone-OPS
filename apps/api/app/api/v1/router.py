from fastapi import APIRouter, Depends

from app.api.dependencies.auth import ADMIN_ROLES, ALL_ROLES, require_roles
from app.api.v1.routes import (
    auth,
    dashboard,
    dji,
    fleet,
    livestream,
    operations,
    reports,
    system,
    users,
)
from app.api.v1.routes import map as map_routes

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(
    system.router,
    prefix="/system",
    tags=["system"],
    dependencies=[Depends(require_roles(ADMIN_ROLES))],
)
api_router.include_router(dji.router, prefix="/dji", tags=["dji-cloud-api"])
api_router.include_router(
    fleet.router,
    prefix="/fleet",
    tags=["fleet"],
    dependencies=[Depends(require_roles(ALL_ROLES))],
)
api_router.include_router(map_routes.router)
api_router.include_router(livestream.router)
api_router.include_router(reports.router)
api_router.include_router(operations.router)
api_router.include_router(dashboard.router, dependencies=[Depends(require_roles(ALL_ROLES))])
