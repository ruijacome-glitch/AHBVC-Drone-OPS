import json
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from secrets import token_urlsafe
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.api.dependencies.auth import ALL_ROLES, STREAM_ROLES, AuthenticatedUser, require_roles
from app.api.v1.routes.auth import verify_csrf
from app.core.config import settings
from app.db.session import AsyncSessionLocal


router = APIRouter(prefix="/stream-shares", tags=["stream-sharing"])
ALLOWED_PERMISSIONS = {"video", "map", "telemetry", "markers", "history"}


class CreateShareRequest(BaseModel):
    label: str = Field(min_length=2, max_length=120)
    gateway_sn: str = Field(min_length=3, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    video_id: str | None = Field(default=None, max_length=200)
    permissions: set[str] = Field(default_factory=lambda: {"video"})
    expires_in_hours: int | None = Field(default=8, ge=1, le=87600)
    target_type: Literal["stream", "aircraft", "mission"] = "stream"
    gateway_sns: list[str] = Field(default_factory=list, max_length=16)
    video_ids: list[str] = Field(default_factory=list, max_length=64)
    sources: list[dict[str, object]] = Field(default_factory=list, max_length=16)
    aircraft_sn: str | None = Field(default=None, max_length=64)
    mission_id: UUID | None = None


def _hash_token(token: str) -> str:
    return sha256(token.encode("utf-8")).hexdigest()


def _public_url(token: str) -> str:
    return f"https://{settings.root_domain}/share?token={token}"


@router.post("", dependencies=[Depends(verify_csrf)])
async def create_share_link(
    payload: CreateShareRequest,
    user: Annotated[AuthenticatedUser, Depends(require_roles(STREAM_ROLES))],
) -> dict[str, object]:
    invalid = payload.permissions - ALLOWED_PERMISSIONS
    if invalid:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid share permission")
    if "video" not in payload.permissions:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Video permission is required")
    if user.organisation_id is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User has no organisation")

    gateway_sns = list(dict.fromkeys(payload.gateway_sns or [payload.gateway_sn]))
    video_ids = list(dict.fromkeys(payload.video_ids or ([payload.video_id] if payload.video_id else [])))
    if payload.target_type == "aircraft" and not payload.aircraft_sn:
        raise HTTPException(status_code=422, detail="Aircraft serial is required")
    if payload.target_type == "mission" and not payload.mission_id:
        raise HTTPException(status_code=422, detail="Mission is required")
    if not gateway_sns:
        raise HTTPException(status_code=422, detail="At least one stream source is required")
    if payload.target_type == "stream" and not video_ids:
        raise HTTPException(status_code=422, detail="A video source is required for a single-stream link")
    sources = payload.sources or [
        {"gateway_sn": gateway_sn, "video_ids": video_ids}
        for gateway_sn in gateway_sns
    ]

    raw_token = token_urlsafe(48)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=payload.expires_in_hours) if payload.expires_in_hours else None
    async with AsyncSessionLocal() as session, session.begin():
        if payload.mission_id:
            mission = await session.execute(
                text(
                    """
                    SELECT id FROM missions
                    WHERE id = :mission_id
                      AND organisation_id = CAST(:organisation_id AS uuid)
                    """
                ),
                {"mission_id": payload.mission_id, "organisation_id": user.organisation_id},
            )
            if mission.scalar_one_or_none() is None:
                raise HTTPException(status_code=404, detail="Mission not found")
        result = await session.execute(
            text(
                """
                INSERT INTO stream_share_links (
                  organisation_id, created_by, token_hash, label, gateway_sn,
                  video_id, permissions, expires_at, target_type, target_config
                ) VALUES (
                  :organisation_id, :created_by, :token_hash, :label, :gateway_sn,
                  :video_id, CAST(:permissions AS jsonb), :expires_at, :target_type,
                  CAST(:target_config AS jsonb)
                )
                RETURNING id, label, gateway_sn, video_id, permissions, expires_at
                """
            ),
            {
                "organisation_id": user.organisation_id,
                "created_by": user.id,
                "token_hash": _hash_token(raw_token),
                "label": payload.label,
                "gateway_sn": payload.gateway_sn,
                "video_id": payload.video_id,
                "permissions": json.dumps(sorted(payload.permissions)),
                "expires_at": expires_at,
                "target_type": payload.target_type,
                "target_config": json.dumps({
                    "gateway_sns": gateway_sns,
                    "video_ids": video_ids,
                    "sources": sources,
                    "aircraft_sn": payload.aircraft_sn,
                    "mission_id": str(payload.mission_id) if payload.mission_id else None,
                }),
            },
        )
        row = result.mappings().one()
    return {**dict(row), "token": raw_token, "public_url": _public_url(raw_token)}


@router.get("", dependencies=[Depends(require_roles(ALL_ROLES))])
async def list_share_links(
    user: Annotated[AuthenticatedUser, Depends(require_roles(ALL_ROLES))],
) -> list[dict[str, object]]:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            text(
                """
                SELECT id, label, gateway_sn, video_id, permissions, expires_at,
                       revoked_at, created_at, last_accessed_at, target_type,
                       target_config
                FROM stream_share_links
                WHERE organisation_id = CAST(:organisation_id AS uuid)
                ORDER BY created_at DESC
                LIMIT 100
                """
            ),
            {"organisation_id": user.organisation_id},
        )
        return [dict(row) for row in result.mappings().all()]


@router.post("/{share_id}/revoke", dependencies=[Depends(verify_csrf)])
async def revoke_share_link(
    share_id: UUID,
    user: Annotated[AuthenticatedUser, Depends(require_roles(STREAM_ROLES))],
) -> dict[str, str]:
    async with AsyncSessionLocal() as session, session.begin():
        result = await session.execute(
            text(
                """
                UPDATE stream_share_links
                SET revoked_at = now()
                WHERE id = :share_id
                  AND organisation_id = CAST(:organisation_id AS uuid)
                  AND revoked_at IS NULL
                RETURNING id
                """
            ),
            {"share_id": share_id, "organisation_id": user.organisation_id},
        )
        if result.scalar_one_or_none() is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share link not found")
    return {"status": "revoked"}


@router.get("/public/{token}")
async def resolve_public_share(token: str) -> dict[str, object]:
    if len(token) < 32 or len(token) > 128:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share link not found")
    async with AsyncSessionLocal() as session, session.begin():
        result = await session.execute(
            text(
                """
                UPDATE stream_share_links
                SET last_accessed_at = now()
                WHERE token_hash = :token_hash
                  AND revoked_at IS NULL
                  AND (expires_at IS NULL OR expires_at > now())
                RETURNING label, gateway_sn, video_id, permissions, expires_at,
                          target_type, target_config
                """
            ),
            {"token_hash": _hash_token(token)},
        )
        row = result.mappings().first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share link expired or revoked")
    target_config = row.get("target_config") or {}
    configured_sources = target_config.get("sources")
    if isinstance(configured_sources, list) and configured_sources:
        streams = [
            {
                "gateway_sn": source.get("gateway_sn"),
                "video_id": video_id,
                "stream_url": f"https://{settings.stream_public_host}/live/{source.get('gateway_sn')}",
            }
            for source in configured_sources if isinstance(source, dict)
            for video_id in (source.get("video_ids") or [None])
        ]
    else:
        gateway_sns = target_config.get("gateway_sns") or [row["gateway_sn"]]
        video_ids = target_config.get("video_ids") or ([row["video_id"]] if row["video_id"] else [None])
        streams = [
            {
                "gateway_sn": gateway_sn,
                "video_id": video_id,
                "stream_url": f"https://{settings.stream_public_host}/live/{gateway_sn}",
            }
            for gateway_sn in gateway_sns
            for video_id in video_ids
        ]
    return {
        **dict(row),
        "stream_url": f"https://{settings.stream_public_host}/live/{row['gateway_sn']}",
        "streams": streams,
    }
