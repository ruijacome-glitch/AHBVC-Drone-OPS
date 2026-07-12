from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.api.dependencies.auth import AuthenticatedUser, STREAM_ROLES, require_roles
from app.core.config import settings
from app.core.security import (
    create_access_token,
    decode_access_token,
    hash_password,
    hash_refresh_token,
    new_refresh_token,
    verify_password,
)
from app.main import app


def test_password_hash_is_not_reversible_plaintext() -> None:
    password_hash = hash_password("StrongPassword123")
    assert password_hash != "StrongPassword123"
    assert verify_password("StrongPassword123", password_hash) is True
    assert verify_password("WrongPassword123", password_hash) is False


def test_access_token_round_trip() -> None:
    previous_secret = settings.jwt_secret_key
    settings.jwt_secret_key = "test-secret-that-is-long-enough"
    user_id = uuid4()
    try:
        assert decode_access_token(create_access_token(user_id)) == user_id
    finally:
        settings.jwt_secret_key = previous_secret


def test_refresh_token_is_only_persisted_as_hash() -> None:
    raw_token, token_hash = new_refresh_token()
    assert raw_token != token_hash
    assert len(token_hash) == 64
    assert hash_refresh_token(raw_token) == token_hash


def test_dashboard_requires_human_authentication() -> None:
    client = TestClient(app)
    response = client.get("/api/v1/dashboard/summary")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_observer_cannot_control_livestream() -> None:
    observer = AuthenticatedUser(
        id=uuid4(),
        organisation_id=None,
        email="observer@example.org",
        full_name="Observer",
        roles=frozenset({"Observador"}),
    )
    with pytest.raises(HTTPException) as error:
        await require_roles(STREAM_ROLES)(observer)
    assert error.value.status_code == 403


@pytest.mark.asyncio
async def test_pilot_can_control_livestream() -> None:
    pilot = AuthenticatedUser(
        id=uuid4(),
        organisation_id=None,
        email="pilot@example.org",
        full_name="Pilot",
        roles=frozenset({"Piloto"}),
    )
    assert await require_roles(STREAM_ROLES)(pilot) == pilot
