from email.message import EmailMessage

import aiosmtplib

from app.core.config import settings


class EmailNotConfiguredError(RuntimeError):
    pass


class EmailService:
    async def send_message(
        self,
        recipients: list[str],
        subject: str,
        text_body: str,
        html_body: str | None = None,
    ) -> None:
        message = self._new_message(recipients, subject)
        message.set_content(text_body)
        if html_body:
            message.add_alternative(html_body, subtype="html")
        await self._send(message)

    async def send_report(
        self,
        recipients: list[str],
        subject: str,
        body: str,
        filename: str,
        pdf: bytes,
    ) -> None:
        message = self._new_message(recipients, subject)
        message.set_content(body)
        message.add_attachment(pdf, maintype="application", subtype="pdf", filename=filename)
        await self._send(message)

    def _new_message(self, recipients: list[str], subject: str) -> EmailMessage:
        if not settings.smtp_host or not settings.smtp_from_email:
            raise EmailNotConfiguredError("SMTP is not configured")
        if settings.smtp_start_tls and settings.smtp_use_tls:
            raise EmailNotConfiguredError("SMTP TLS modes are mutually exclusive")
        message = EmailMessage()
        message["From"] = f"{settings.smtp_from_name} <{settings.smtp_from_email}>"
        message["To"] = ", ".join(recipients)
        message["Subject"] = subject
        return message

    async def _send(self, message: EmailMessage) -> None:
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
