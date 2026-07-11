from fastapi import APIRouter, HTTPException, Path
from fastapi.responses import Response
import httpx


router = APIRouter(prefix="/map", tags=["map"])


@router.get("/tiles/{z}/{x}/{y}.png", responses={200: {"content": {"image/png": {}}}})
async def osm_tile(
    z: int = Path(ge=0, le=19),
    x: int = Path(ge=0),
    y: int = Path(ge=0),
) -> Response:
    tile_limit = 1 << z
    if x >= tile_limit or y >= tile_limit:
        raise HTTPException(status_code=404, detail="Tile outside map bounds")
    async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
        upstream = await client.get(
            f"https://tile.openstreetmap.org/{z}/{x}/{y}.png",
            headers={"User-Agent": "AHBVC-UAS-Platform/0.1 (https://uas.ahbvc.org.pt)"},
        )
    if upstream.status_code != 200:
        raise HTTPException(status_code=upstream.status_code, detail="Map tile unavailable")
    return Response(content=upstream.content, media_type="image/png", headers={"Cache-Control": "public, max-age=86400"})
