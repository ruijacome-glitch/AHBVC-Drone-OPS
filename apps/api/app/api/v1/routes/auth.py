import hmac
import logging
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Request, Response, status
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, EmailStr, Field, model_validator
from redis.asyncio import Redis
from redis.exceptions import RedisError
from sqlalchemy import text

from app.api.dependencies.auth import AuthenticatedUser, current_user
from app.core.config import settings
from app.core.security import (
    create_access_token,
    DUMMY_PASSWORD_HASH,
    hash_invitation_token,
    hash_password,
    hash_refresh_token,
    new_csrf_token,
    new_refresh_token,
    validate_password_strength,
    verify_password,
)
from app.db.session import AsyncSessionLocal


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["authentication"])
redis_client = Redis.from_url(settings.redis_url, decode_responses=True)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class ActivateAccountRequest(BaseModel):
    token: str = Field(min_length=64, max_length=256)
    password: str = Field(min_length=12, max_length=128)
    password_confirmation: str = Field(min_length=12, max_length=128)

    @model_validator(mode="after")
    def validate_passwords(self) -> "ActivateAccountRequest":
        validate_password_strength(self.password)
        if self.password != self.password_confirmation:
            raise ValueError("Passwords do not match")
        return self


class UserResponse(BaseModel):
    id: UUID
    email: EmailStr
    full_name: str
    roles: list[str]


def _user_response(user: AuthenticatedUser) -> UserResponse:
    return UserResponse(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        roles=sorted(user.roles),
    )


def _cookie_domain() -> str | None:
    return settings.auth_cookie_domain or None


def _set_session_cookies(
    response: Response,
    access_token: str,
    refresh_token: str,
    csrf_token: str,
) -> None:
    common = {
        "secure": settings.auth_cookie_secure,
        "samesite": "strict",
        "domain": _cookie_domain(),
    }
    response.set_cookie(
        "uas_access",
        access_token,
        httponly=True,
        max_age=settings.access_token_expire_minutes * 60,
        path="/",
        **common,
    )
    response.set_cookie(
        "uas_refresh",
        refresh_token,
        httponly=True,
        max_age=settings.refresh_token_expire_days * 86400,
        path="/api/v1/auth",
        **common,
    )
    response.set_cookie(
        "uas_csrf",
        csrf_token,
        httponly=False,
        max_age=settings.refresh_token_expire_days * 86400,
        path="/",
        **common,
    )


def _clear_session_cookies(response: Response) -> None:
    common = {"domain": _cookie_domain(), "secure": settings.auth_cookie_secure, "samesite": "strict"}
    response.delete_cookie("uas_access", path="/", httponly=True, **common)
    response.delete_cookie("uas_refresh", path="/api/v1/auth", httponly=True, **common)
    response.delete_cookie("uas_csrf", path="/", httponly=False, **common)


def _client_details(request: Request) -> tuple[str | None, str | None]:
    forwarded_for = request.headers.get("x-forwarded-for", "").split(",", 1)[0].strip()
    ip_address = forwarded_for or (request.client.host if request.client else None)
    return ip_address, request.headers.get("user-agent", "")[:512] or None


def verify_same_origin(request: Request) -> None:
    origin = request.headers.get("origin")
    if origin and origin not in settings.cors_origins:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid request origin")


def verify_csrf(
    request: Request,
    csrf_header: Annotated[str | None, Header(alias="x-csrf-token")] = None,
    csrf_cookie: Annotated[str | None, Cookie(alias="uas_csrf")] = None,
) -> None:
    verify_same_origin(request)
    if not csrf_header or not csrf_cookie or not hmac.compare_digest(csrf_header, csrf_cookie):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid CSRF token")


async def _check_login_rate_limit(request: Request, email: str) -> str:
    ip_address, _ = _client_details(request)
    identity = sha256(f"{ip_address}:{email.lower()}".encode()).hexdigest()
    key = f"auth:login:{identity}"
    try:
        attempts = await redis_client.incr(key)
        if attempts == 1:
            await redis_client.expire(key, settings.login_rate_limit_window_seconds)
    except RedisError as exc:
        logger.exception("Authentication rate limiter unavailable")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication temporarily unavailable",
        ) from exc
    if attempts > settings.login_rate_limit_attempts:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many login attempts")
    return key


async def _check_activation_rate_limit(request: Request) -> None:
    ip_address, _ = _client_details(request)
    key = f"auth:activate:{sha256(str(ip_address).encode()).hexdigest()}"
    try:
        attempts = await redis_client.incr(key)
        if attempts == 1:
            await redis_client.expire(key, settings.login_rate_limit_window_seconds)
    except RedisError as exc:
        raise HTTPException(status_code=503, detail="Authentication temporarily unavailable") from exc
    if attempts > 10:
        raise HTTPException(status_code=429, detail="Too many activation attempts")


async def _load_user_by_email(email: str) -> tuple[AuthenticatedUser, str] | None:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            text(
                """
                SELECT u.id, u.organisation_id, u.email, u.full_name, u.password_hash,
                       COALESCE(array_agg(r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles
                FROM users u
                LEFT JOIN user_roles ur ON ur.user_id = u.id
                LEFT JOIN roles r ON r.id = ur.role_id
                WHERE lower(u.email) = lower(:email) AND u.is_active = true
                GROUP BY u.id
                """
            ),
            {"email": email},
        )
        row = result.mappings().first()
    if row is None:
        return None
    return (
        AuthenticatedUser(
            id=row["id"],
            organisation_id=row["organisation_id"],
            email=row["email"],
            full_name=row["full_name"],
            roles=frozenset(row["roles"]),
        ),
        row["password_hash"],
    )


async def _store_refresh_token(
    user: AuthenticatedUser,
    token_hash: str,
    request: Request,
) -> None:
    ip_address, user_agent = _client_details(request)
    async with AsyncSessionLocal() as session:
        await session.execute(
            text(
                """
                INSERT INTO refresh_tokens (user_id, token_hash, expires_at, ip_address, user_agent)
                VALUES (:user_id, :token_hash, :expires_at, CAST(:ip_address AS inet), :user_agent)
                """
            ),
            {
                "user_id": user.id,
                "token_hash": token_hash,
                "expires_at": datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expire_days),
                "ip_address": ip_address,
                "user_agent": user_agent,
            },
        )
        await session.execute(
            text("UPDATE users SET last_login_at = now(), updated_at = now() WHERE id = :user_id"),
            {"user_id": user.id},
        )
        await session.execute(
            text(
                """
                INSERT INTO audit_logs (actor_user_id, organisation_id, action, entity_type, entity_id, ip_address)
                VALUES (:user_id, :organisation_id, 'auth.login', 'user', :entity_id, CAST(:ip_address AS inet))
                """
            ),
            {
                "user_id": user.id,
                "organisation_id": user.organisation_id,
                "entity_id": str(user.id),
                "ip_address": ip_address,
            },
        )
        await session.commit()


@router.post("/login", response_model=UserResponse)
async def login(payload: LoginRequest, request: Request, response: Response) -> UserResponse:
    verify_same_origin(request)
    if settings.jwt_secret_key == "change-me":
        raise HTTPException(status_code=503, detail="Authentication is not configured")
    rate_key = await _check_login_rate_limit(request, str(payload.email))
    loaded = await _load_user_by_email(str(payload.email))
    candidate_hash = loaded[1] if loaded else DUMMY_PASSWORD_HASH
    password_valid = await run_in_threadpool(verify_password, payload.password, candidate_hash)
    if loaded is None or not password_valid:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    user = loaded[0]
    await redis_client.delete(rate_key)
    raw_refresh, refresh_hash = new_refresh_token()
    csrf_token = new_csrf_token()
    await _store_refresh_token(user, refresh_hash, request)
    _set_session_cookies(response, create_access_token(user.id), raw_refresh, csrf_token)
    return _user_response(user)


@router.post("/activate")
async def activate_account(payload: ActivateAccountRequest, request: Request) -> dict[str, str]:
    verify_same_origin(request)
    await _check_activation_rate_limit(request)
    token_hash = hash_invitation_token(payload.token)
    password_hash = await run_in_threadpool(hash_password, payload.password)
    ip_address, _ = _client_details(request)
    async with AsyncSessionLocal() as session, session.begin():
        result = await session.execute(
            text(
                """
                SELECT ui.id AS invitation_id, u.id AS user_id, u.organisation_id
                FROM user_invitations ui
                JOIN users u ON u.id = ui.user_id
                WHERE ui.token_hash = :token_hash
                  AND ui.used_at IS NULL
                  AND ui.expires_at > now()
                  AND u.is_active = false
                FOR UPDATE OF ui, u
                """
            ),
            {"token_hash": token_hash},
        )
        row = result.mappings().first()
        if row is None:
            raise HTTPException(status_code=400, detail="Invalid or expired invitation")
        await session.execute(
            text(
                """
                UPDATE users
                SET password_hash = :password_hash, is_active = true,
                    activated_at = now(), updated_at = now()
                WHERE id = :user_id
                """
            ),
            {"password_hash": password_hash, "user_id": row["user_id"]},
        )
        await session.execute(
            text(
                """
                UPDATE user_invitations SET used_at = now()
                WHERE user_id = :user_id AND used_at IS NULL
                """
            ),
            {"user_id": row["user_id"]},
        )
        await session.execute(
            text(
                """
                INSERT INTO audit_logs (
                    actor_user_id, organisation_id, action, entity_type,
                    entity_id, ip_address
                ) VALUES (
                    :user_id, :organisation_id, 'user.activate', 'user',
                    :entity_id, CAST(:ip_address AS inet)
                )
                """
            ),
            {
                "user_id": row["user_id"],
                "organisation_id": row["organisation_id"],
                "entity_id": str(row["user_id"]),
                "ip_address": ip_address,
            },
        )
    return {"status": "activated"}


@router.post("/refresh", response_model=UserResponse, dependencies=[Depends(verify_csrf)])
async def refresh_session(
    request: Request,
    response: Response,
    refresh_token: Annotated[str | None, Cookie(alias="uas_refresh")] = None,
) -> UserResponse:
    if not refresh_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh session required")
    current_hash = hash_refresh_token(refresh_token)
    new_raw, new_hash = new_refresh_token()
    ip_address, user_agent = _client_details(request)
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            text(
                """
                SELECT rt.id AS token_id, u.id, u.organisation_id, u.email, u.full_name,
                       ARRAY(
                         SELECT r.name FROM user_roles ur
                         JOIN roles r ON r.id = ur.role_id
                         WHERE ur.user_id = u.id
                         ORDER BY r.name
                       ) AS roles
                FROM refresh_tokens rt
                JOIN users u ON u.id = rt.user_id AND u.is_active = true
                WHERE rt.token_hash = :token_hash AND rt.revoked_at IS NULL AND rt.expires_at > now()
                FOR UPDATE OF rt
                """
            ),
            {"token_hash": current_hash},
        )
        row = result.mappings().first()
        if row is None:
            _clear_session_cookies(response)
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh session")
        inserted = await session.execute(
            text(
                """
                INSERT INTO refresh_tokens (user_id, token_hash, expires_at, ip_address, user_agent)
                VALUES (:user_id, :token_hash, :expires_at, CAST(:ip_address AS inet), :user_agent)
                RETURNING id
                """
            ),
            {
                "user_id": row["id"],
                "token_hash": new_hash,
                "expires_at": datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expire_days),
                "ip_address": ip_address,
                "user_agent": user_agent,
            },
        )
        replacement_id = inserted.scalar_one()
        await session.execute(
            text(
                """
                UPDATE refresh_tokens
                SET revoked_at = now(), last_used_at = now(), replaced_by_token_id = :replacement_id
                WHERE id = :token_id
                """
            ),
            {"replacement_id": replacement_id, "token_id": row["token_id"]},
        )
        await session.commit()
    user = AuthenticatedUser(
        id=row["id"],
        organisation_id=row["organisation_id"],
        email=row["email"],
        full_name=row["full_name"],
        roles=frozenset(row["roles"]),
    )
    _set_session_cookies(response, create_access_token(user.id), new_raw, new_csrf_token())
    return _user_response(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)])
async def logout(
    response: Response,
    refresh_token: Annotated[str | None, Cookie(alias="uas_refresh")] = None,
) -> None:
    if refresh_token:
        async with AsyncSessionLocal() as session:
            await session.execute(
                text("UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = :token_hash"),
                {"token_hash": hash_refresh_token(refresh_token)},
            )
            await session.commit()
    _clear_session_cookies(response)


@router.get("/me", response_model=UserResponse)
async def me(user: Annotated[AuthenticatedUser, Depends(current_user)]) -> UserResponse:
    return _user_response(user)
