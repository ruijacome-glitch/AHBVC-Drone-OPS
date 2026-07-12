from dataclasses import dataclass
from typing import Annotated, Callable
from uuid import UUID

from fastapi import Cookie, Depends, HTTPException, status
from sqlalchemy import text

from app.core.security import decode_access_token
from app.db.session import AsyncSessionLocal


ALL_ROLES = frozenset({"Administrador", "Operador", "Piloto", "Observador"})
STREAM_ROLES = frozenset({"Administrador", "Operador", "Piloto"})
ADMIN_ROLES = frozenset({"Administrador"})
PILOT_ROLES = frozenset({"Administrador", "Piloto"})


@dataclass(frozen=True)
class AuthenticatedUser:
    id: UUID
    organisation_id: UUID | None
    email: str
    full_name: str
    roles: frozenset[str]


async def current_user(
    access_token: Annotated[str | None, Cookie(alias="uas_access")] = None,
) -> AuthenticatedUser:
    if not access_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
    try:
        user_id = decode_access_token(access_token)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session") from exc

    async with AsyncSessionLocal() as session:
        result = await session.execute(
            text(
                """
                SELECT u.id, u.organisation_id, u.email, u.full_name,
                       COALESCE(array_agg(r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles
                FROM users u
                LEFT JOIN user_roles ur ON ur.user_id = u.id
                LEFT JOIN roles r ON r.id = ur.role_id
                WHERE u.id = :user_id AND u.is_active = true
                GROUP BY u.id
                """
            ),
            {"user_id": user_id},
        )
        row = result.mappings().first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session")
    return AuthenticatedUser(
        id=row["id"],
        organisation_id=row["organisation_id"],
        email=row["email"],
        full_name=row["full_name"],
        roles=frozenset(row["roles"]),
    )


def require_roles(allowed_roles: frozenset[str]) -> Callable[..., AuthenticatedUser]:
    async def dependency(
        user: Annotated[AuthenticatedUser, Depends(current_user)],
    ) -> AuthenticatedUser:
        if not user.roles.intersection(allowed_roles):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
        return user

    return dependency
