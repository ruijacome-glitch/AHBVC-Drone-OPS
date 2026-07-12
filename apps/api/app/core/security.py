from datetime import datetime, timedelta, timezone
from hashlib import sha256
from secrets import token_urlsafe
from uuid import UUID, uuid4

from jose import JWTError, jwt
from pwdlib import PasswordHash

from app.core.config import settings


password_hasher = PasswordHash.recommended()
DUMMY_PASSWORD_HASH = password_hasher.hash("NotARealPassword123")


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def verify_password(password: str, encoded_password: str) -> bool:
    return password_hasher.verify(password, encoded_password)


def create_access_token(user_id: UUID) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "type": "access",
        "iat": now,
        "exp": now + timedelta(minutes=settings.access_token_expire_minutes),
        "jti": str(uuid4()),
        "iss": settings.auth_issuer,
        "aud": settings.auth_audience,
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> UUID:
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret_key,
            algorithms=[settings.jwt_algorithm],
            issuer=settings.auth_issuer,
            audience=settings.auth_audience,
        )
        if payload.get("type") != "access":
            raise JWTError("Invalid token type")
        return UUID(payload["sub"])
    except (JWTError, KeyError, TypeError, ValueError) as exc:
        raise ValueError("Invalid access token") from exc


def new_refresh_token() -> tuple[str, str]:
    raw_token = token_urlsafe(48)
    return raw_token, hash_refresh_token(raw_token)


def hash_refresh_token(raw_token: str) -> str:
    return sha256(raw_token.encode("utf-8")).hexdigest()


def new_invitation_token() -> tuple[str, str]:
    raw_token = token_urlsafe(64)
    return raw_token, sha256(raw_token.encode("utf-8")).hexdigest()


def hash_invitation_token(raw_token: str) -> str:
    return sha256(raw_token.encode("utf-8")).hexdigest()


def validate_password_strength(password: str) -> str:
    if len(password) < 12:
        raise ValueError("Password must contain at least 12 characters")
    if not any(char.islower() for char in password):
        raise ValueError("Password must include a lowercase letter")
    if not any(char.isupper() for char in password):
        raise ValueError("Password must include an uppercase letter")
    if not any(char.isdigit() for char in password):
        raise ValueError("Password must include a number")
    return password


def new_csrf_token() -> str:
    return token_urlsafe(32)
