from email.message import EmailMessage

import aiosmtplib

from app.core.config import settings


class EmailNotConfiguredError(RuntimeError):
    pass


class EmailService:
    async def send_report(
        self,
        recipients: list[str],
        subject: str,
        body: str,
        filename: str,
        pdf: bytes,
    ) -> None:
        if not settings.smtp_host or not settings.smtp_from_email:
            raise EmailNotConfiguredError("SMTP is not configured")
        if settings.smtp_start_tls and settings.smtp_use_tls:
            raise EmailNotConfiguredError("SMTP TLS modes are mutually exclusive")

        message = EmailMessage()
        message["From"] = f"{settings.smtp_from_name} <{settings.smtp_from_email}>"
        message["To"] = ", ".join(recipients)
        message["Subject"] = subject
        message.set_content(body)
        message.add_attachment(pdf, maintype="application", subtype="pdf", filename=filename)

        await aiosmtplib.send(
            message,
            hostname=settings.smtp_host,
            port=settings.smtp_port,
            username=settings.smtp_username,
            password=settings.smtp_password,
            start_tls=settings.smtp_start_tls,
            use_tls=settings.smtp_use_tls,
            timeout=30,
        )


email_service = EmailService()
