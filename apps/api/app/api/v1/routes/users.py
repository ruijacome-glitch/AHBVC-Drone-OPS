from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.api.dependencies.auth import ADMIN_ROLES, AuthenticatedUser, require_roles
from app.api.v1.routes.auth import verify_csrf
from app.core.security import hash_password
from app.db.session import AsyncSessionLocal


RoleName = Literal["Administrador", "Operador", "Piloto", "Observador"]
router = APIRouter(prefix="/users", tags=["users"])


class CreateUserRequest(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=120)
    password: str = Field(min_length=12, max_length=128)
    roles: list[RoleName] = Field(min_length=1, max_length=4)

    @field_validator("password")
    @classmethod
    def validate_password_strength(cls, value: str) -> str:
        if not any(char.islower() for char in value):
            raise ValueError("Password must include a lowercase letter")
        if not any(char.isupper() for char in value):
            raise ValueError("Password must include an uppercase letter")
        if not any(char.isdigit() for char in value):
            raise ValueError("Password must include a number")
        return value


class ManagedUserResponse(BaseModel):
    id: UUID
    email: EmailStr
    full_name: str
    is_active: bool
    roles: list[str]


@router.get("", response_model=list[ManagedUserResponse])
async def list_users(
    _: Annotated[AuthenticatedUser, Depends(require_roles(ADMIN_ROLES))],
) -> list[ManagedUserResponse]:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            text(
                """
                SELECT u.id, u.email, u.full_name, u.is_active,
                       COALESCE(array_agg(r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles
                FROM users u
                LEFT JOIN user_roles ur ON ur.user_id = u.id
                LEFT JOIN roles r ON r.id = ur.role_id
                GROUP BY u.id
                ORDER BY u.full_name
                """
            )
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
    password_hash = await run_in_threadpool(hash_password, payload.password)
    ip_address = request.client.host if request.client else None
    try:
        async with AsyncSessionLocal() as session:
            created = await session.execute(
                text(
                    """
                    INSERT INTO users (organisation_id, email, full_name, password_hash)
                    VALUES (:organisation_id, lower(:email), :full_name, :password_hash)
                    RETURNING id, email, full_name, is_active
                    """
                ),
                {
                    "organisation_id": actor.organisation_id,
                    "email": str(payload.email),
                    "full_name": payload.full_name.strip(),
                    "password_hash": password_hash,
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
                {"user_id": row["id"], "roles": list(dict.fromkeys(payload.roles))},
            )
            await session.execute(
                text(
                    """
                    INSERT INTO audit_logs (
                      actor_user_id, organisation_id, action, entity_type, entity_id, ip_address, metadata
                    ) VALUES (
                      :actor_id, :organisation_id, 'user.create', 'user', :entity_id,
                      CAST(:ip_address AS inet), jsonb_build_object('roles', CAST(:roles AS text[]))
                    )
                    """
                ),
                {
                    "actor_id": actor.id,
                    "organisation_id": actor.organisation_id,
                    "entity_id": str(row["id"]),
                    "ip_address": ip_address,
                    "roles": list(dict.fromkeys(payload.roles)),
                },
            )
            await session.commit()
    except IntegrityError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already exists") from exc
    return ManagedUserResponse(**dict(row), roles=list(dict.fromkeys(payload.roles)))
