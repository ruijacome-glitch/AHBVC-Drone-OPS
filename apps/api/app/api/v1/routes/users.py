from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal
from uuid import UUID

import aiosmtplib
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.api.dependencies.auth import ADMIN_ROLES, AuthenticatedUser, require_roles
from app.api.v1.routes.auth import verify_csrf
from app.core.config import settings
from app.core.security import DUMMY_PASSWORD_HASH, new_invitation_token
from app.db.session import AsyncSessionLocal
from app.services.email import EmailNotConfiguredError
from app.services.invitations import send_user_invitation


RoleName = Literal["Administrador", "Operador", "Piloto", "Observador"]
InvitationStatus = Literal["pending", "sent", "failed", "accepted"]
router = APIRouter(prefix="/users", tags=["users"])


class CreateUserRequest(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=120)
    roles: list[RoleName] = Field(min_length=1, max_length=4)


class ManagedUserResponse(BaseModel):
    id: UUID
    email: EmailStr
    full_name: str
    is_active: bool
    roles: list[str]
    invitation_status: InvitationStatus


async def _new_invitation(session, user_id: UUID, actor_id: UUID) -> tuple[UUID, str]:
    raw_token, token_hash = new_invitation_token()
    await session.execute(
        text(
            """
            UPDATE user_invitations SET used_at = now()
            WHERE user_id = :user_id AND used_at IS NULL
            """
        ),
        {"user_id": user_id},
    )
    result = await session.execute(
        text(
            """
            INSERT INTO user_invitations (user_id, token_hash, expires_at, created_by)
            VALUES (:user_id, :token_hash, :expires_at, :created_by)
            RETURNING id
            """
        ),
        {
            "user_id": user_id,
            "token_hash": token_hash,
            "expires_at": datetime.now(timezone.utc)
            + timedelta(hours=settings.invitation_expire_hours),
            "created_by": actor_id,
        },
    )
    return result.scalar_one(), raw_token


async def _deliver_invitation(
    invitation_id: UUID,
    email: str,
    full_name: str,
    roles: list[str],
    raw_token: str,
) -> InvitationStatus:
    delivery_status: InvitationStatus = "sent"
    delivery_error = None
    try:
        await send_user_invitation(email, full_name, roles, raw_token)
    except (EmailNotConfiguredError, aiosmtplib.SMTPException, OSError, TimeoutError) as exc:
        delivery_status = "failed"
        delivery_error = str(exc)[:1000]
    async with AsyncSessionLocal() as session, session.begin():
        await session.execute(
            text(
                """
                UPDATE user_invitations
                SET delivery_status = :status, delivery_error = :error,
                    sent_at = CASE WHEN :status = 'sent' THEN now() ELSE sent_at END
                WHERE id = :invitation_id
                """
            ),
            {"status": delivery_status, "error": delivery_error, "invitation_id": invitation_id},
        )
    return delivery_status


@router.get("", response_model=list[ManagedUserResponse])
async def list_users(
    actor: Annotated[AuthenticatedUser, Depends(require_roles(ADMIN_ROLES))],
) -> list[ManagedUserResponse]:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            text(
                """
                SELECT u.id, u.email, u.full_name, u.is_active,
                       COALESCE(array_agg(DISTINCT r.name)
                         FILTER (WHERE r.name IS NOT NULL), '{}') AS roles,
                       CASE
                         WHEN u.is_active THEN 'accepted'
                         ELSE COALESCE((
                           SELECT ui.delivery_status FROM user_invitations ui
                           WHERE ui.user_id = u.id
                           ORDER BY ui.created_at DESC LIMIT 1
                         ), 'pending')
                       END AS invitation_status
                FROM users u
                LEFT JOIN user_roles ur ON ur.user_id = u.id
                LEFT JOIN roles r ON r.id = ur.role_id
                WHERE CAST(:organisation_id AS uuid) IS NULL
                   OR u.organisation_id = CAST(:organisation_id AS uuid)
                GROUP BY u.id
                ORDER BY u.full_name
                """
            ),
            {"organisation_id": actor.organisation_id},
        )
    return [ManagedUserResponse(**dict(row)) for row in result.mappings().all()]


@router.post(
    "",
    response_model=ManagedUserResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
)
async def create_user(
    payload: CreateUserRequest,
    request: Request,
    actor: Annotated[AuthenticatedUser, Depends(require_roles(ADMIN_ROLES))],
) -> ManagedUserResponse:
    roles = list(dict.fromkeys(payload.roles))
    ip_address = request.client.host if request.client else None
    try:
        async with AsyncSessionLocal() as session, session.begin():
            created = await session.execute(
                text(
                    """
                    INSERT INTO users (
                        organisation_id, email, full_name, password_hash, is_active, invited_at
                    ) VALUES (
                        :organisation_id, lower(:email), :full_name, :password_hash, false, now()
                    )
                    RETURNING id, email, full_name, is_active
                    """
                ),
                {
                    "organisation_id": actor.organisation_id,
                    "email": str(payload.email),
                    "full_name": payload.full_name.strip(),
                    "password_hash": DUMMY_PASSWORD_HASH,
                },
            )
            row = created.mappings().one()
            await session.execute(
                text(
                    """
                    INSERT INTO user_roles (user_id, role_id)
                    SELECT :user_id, id FROM roles WHERE name = ANY(:roles)
                    """
                ),
                {"user_id": row["id"], "roles": roles},
            )
            invitation_id, raw_token = await _new_invitation(session, row["id"], actor.id)
            await session.execute(
                text(
                    """
                    INSERT INTO audit_logs (
                      actor_user_id, organisation_id, action, entity_type,
                      entity_id, ip_address, metadata
                    ) VALUES (
                      :actor_id, :organisation_id, 'user.invite', 'user', :entity_id,
                      CAST(:ip_address AS inet), jsonb_build_object('roles', CAST(:roles AS text[]))
                    )
                    """
                ),
                {
                    "actor_id": actor.id,
                    "organisation_id": actor.organisation_id,
                    "entity_id": str(row["id"]),
                    "ip_address": ip_address,
                    "roles": roles,
                },
            )
    except IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already exists",
        ) from exc

    invitation_status = await _deliver_invitation(
        invitation_id, row["email"], row["full_name"], roles, raw_token
    )
    return ManagedUserResponse(**dict(row), roles=roles, invitation_status=invitation_status)


@router.post(
    "/{user_id}/invite",
    response_model=ManagedUserResponse,
    dependencies=[Depends(verify_csrf)],
)
async def resend_invitation(
    user_id: UUID,
    actor: Annotated[AuthenticatedUser, Depends(require_roles(ADMIN_ROLES))],
) -> ManagedUserResponse:
    async with AsyncSessionLocal() as session, session.begin():
        result = await session.execute(
            text(
                """
                SELECT u.id, u.email, u.full_name, u.is_active,
                       ARRAY(
                         SELECT r.name FROM user_roles ur
                         JOIN roles r ON r.id = ur.role_id
                         WHERE ur.user_id = u.id ORDER BY r.name
                       ) AS roles
                FROM users u
                WHERE u.id = :user_id
                  AND (CAST(:organisation_id AS uuid) IS NULL OR
                       u.organisation_id = CAST(:organisation_id AS uuid))
                """
            ),
            {"user_id": user_id, "organisation_id": actor.organisation_id},
        )
        row = result.mappings().first()
        if row is None:
            raise HTTPException(status_code=404, detail="User not found")
        if row["is_active"]:
            raise HTTPException(status_code=409, detail="User is already active")
        invitation_id, raw_token = await _new_invitation(session, user_id, actor.id)
    invitation_status = await _deliver_invitation(
        invitation_id, row["email"], row["full_name"], list(row["roles"]), raw_token
    )
    return ManagedUserResponse(**dict(row), invitation_status=invitation_status)
