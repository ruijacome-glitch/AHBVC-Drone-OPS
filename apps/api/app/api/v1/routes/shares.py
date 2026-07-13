import json
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from secrets import token_urlsafe
from typing import Annotated
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
    expires_in_hours: int = Field(default=8, ge=1, le=168)


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

    raw_token = token_urlsafe(48)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=payload.expires_in_hours)
    async with AsyncSessionLocal() as session, session.begin():
        result = await session.execute(
            text(
                """
                INSERT INTO stream_share_links (
                  organisation_id, created_by, token_hash, label, gateway_sn,
                  video_id, permissions, expires_at
                ) VALUES (
                  :organisation_id, :created_by, :token_hash, :label, :gateway_sn,
                  :video_id, CAST(:permissions AS jsonb), :expires_at
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
                       revoked_at, created_at, last_accessed_at
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
                  AND expires_at > now()
                RETURNING label, gateway_sn, video_id, permissions, expires_at
                """
            ),
            {"token_hash": _hash_token(token)},
        )
        row = result.mappings().first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share link expired or revoked")
    return {
        **dict(row),
        "stream_url": f"https://{settings.stream_public_host}/live/{row['gateway_sn']}",
    }
