import argparse
import asyncio
import getpass

from sqlalchemy import text

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Create the initial UAS Platform administrator")
    parser.add_argument("--email", required=True)
    parser.add_argument("--full-name", required=True)
    return parser.parse_args()


async def create_admin(email: str, full_name: str, password: str) -> None:
    async with AsyncSessionLocal() as session:
        existing = await session.execute(
            text("SELECT 1 FROM users WHERE lower(email) = lower(:email)"),
            {"email": email},
        )
        if existing.scalar_one_or_none():
            raise RuntimeError("A user with this email already exists")
        organisation_id = (
            await session.execute(
                text(
                    """
                    INSERT INTO organisations (name, slug)
                    VALUES ('Bombeiros Voluntarios de Cascais', 'ahbvc')
                    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
                    RETURNING id
                    """
                )
            )
        ).scalar_one()
        await session.execute(
            text(
                """
                INSERT INTO roles (name, description)
                VALUES ('Administrador', 'Full platform administration')
                ON CONFLICT (name) DO NOTHING
                """
            )
        )
        user_id = (
            await session.execute(
                text(
                    """
                    INSERT INTO users (organisation_id, email, full_name, password_hash)
                    VALUES (:organisation_id, lower(:email), :full_name, :password_hash)
                    RETURNING id
                    """
                ),
                {
                    "organisation_id": organisation_id,
                    "email": email,
                    "full_name": full_name.strip(),
                    "password_hash": hash_password(password),
                },
            )
        ).scalar_one()
        await session.execute(
            text(
                """
                INSERT INTO user_roles (user_id, role_id)
                SELECT :user_id, id FROM roles WHERE name = 'Administrador'
                """
            ),
            {"user_id": user_id},
        )
        await session.commit()


def main() -> None:
    args = parse_args()
    password = getpass.getpass("Password (minimum 12 characters, upper/lowercase and number): ")
    confirmation = getpass.getpass("Confirm password: ")
    if password != confirmation:
        raise SystemExit("Passwords do not match")
    if len(password) < 12 or not any(c.islower() for c in password) or not any(c.isupper() for c in password) or not any(c.isdigit() for c in password):
        raise SystemExit("Password does not meet complexity requirements")
    asyncio.run(create_admin(args.email, args.full_name, password))
    print("Administrator created successfully")


if __name__ == "__main__":
    main()
