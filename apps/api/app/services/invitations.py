from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

from app.core.config import settings
from app.services.email import email_service


APP_DIR = Path(__file__).resolve().parents[1]
environment = Environment(
    loader=FileSystemLoader(APP_DIR / "templates"),
    autoescape=select_autoescape(["html", "xml"]),
)


async def send_user_invitation(
    email: str,
    full_name: str,
    roles: list[str],
    raw_token: str,
) -> None:
    activation_url = f"https://{settings.root_domain}/activate?token={raw_token}"
    role_text = ", ".join(roles)
    html = environment.get_template("user_invitation.html").render(
        activation_url=activation_url,
        email=email,
        full_name=full_name,
        roles=role_text,
        expiry_hours=settings.invitation_expire_hours,
    )
    text = (
        f"Olá {full_name},\n\n"
        "A sua conta UAS Platform foi criada. Defina a sua password no endereço:\n"
        f"{activation_url}\n\n"
        f"O convite é válido durante {settings.invitation_expire_hours} horas e só pode ser usado uma vez."
    )
    await email_service.send_message([email], "Convite para a UAS Platform", text, html)
