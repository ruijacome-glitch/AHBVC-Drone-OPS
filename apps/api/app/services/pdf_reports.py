from pathlib import Path
from typing import Any

import httpx
from jinja2 import Environment, FileSystemLoader, select_autoescape

from app.core.config import settings


APP_DIR = Path(__file__).resolve().parents[1]
template_environment = Environment(
    loader=FileSystemLoader(APP_DIR / "templates"),
    autoescape=select_autoescape(["html", "xml"]),
)


class PdfReportService:
    async def mission_report(self, data: dict[str, Any], trace_id: str) -> bytes:
        logo_path = APP_DIR / "assets" / "ahbvc.png"
        html = template_environment.get_template("mission_report.html").render(
            report=data, logo_available=logo_path.exists()
        )
        files: list[tuple[str, tuple[str, bytes, str]]] = [
            ("files", ("index.html", html.encode("utf-8"), "text/html")),
        ]
        if logo_path.exists():
            files.append(("files", ("ahbvc.png", logo_path.read_bytes(), "image/png")))

        async with httpx.AsyncClient(timeout=70) as client:
            response = await client.post(
                f"{settings.gotenberg_url}/forms/chromium/convert/html",
                files=files,
                data={
                    "preferCssPageSize": "true",
                    "printBackground": "true",
                    "failOnResourceLoadingFailed": "true",
                },
                headers={"Gotenberg-Trace": trace_id},
            )
        response.raise_for_status()
        return response.content


pdf_report_service = PdfReportService()
