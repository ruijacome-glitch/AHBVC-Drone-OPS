import hashlib
import logging
from datetime import datetime, timezone
from io import BytesIO
from typing import Annotated
from uuid import UUID, uuid4

import aiosmtplib
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from httpx import HTTPError
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import text

from app.api.dependencies.auth import (
    ALL_ROLES,
    REPORT_ROLES,
    AuthenticatedUser,
    require_roles,
)
from app.api.v1.routes.auth import verify_csrf
from app.core.config import settings
from app.db.session import AsyncSessionLocal
from app.services.email import EmailNotConfiguredError, email_service
from app.services.object_storage import object_storage
from app.services.pdf_reports import pdf_report_service


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/reports", tags=["reports"])


class ReportDocumentResponse(BaseModel):
    id: UUID
    mission_id: UUID | None
    report_type: str
    title: str
    size_bytes: int
    generated_at: datetime
    download_url: str


class EmailReportRequest(BaseModel):
    recipients: list[EmailStr] = Field(min_length=1, max_length=10)
    subject: str = Field(min_length=3, max_length=180)
    message: str = Field(min_length=1, max_length=5000)


@router.get("", response_model=list[ReportDocumentResponse])
async def list_reports(
    user: Annotated[AuthenticatedUser, Depends(require_roles(ALL_ROLES))],
    mission_id: UUID | None = None,
) -> list[ReportDocumentResponse]:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            text(
                """
                SELECT id, mission_id, report_type, title, size_bytes, generated_at
                FROM report_documents
                WHERE (:organisation_id IS NULL OR organisation_id = :organisation_id)
                  AND (:mission_id IS NULL OR mission_id = :mission_id)
                ORDER BY generated_at DESC
                LIMIT 100
                """
            ),
            {"organisation_id": user.organisation_id, "mission_id": mission_id},
        )
        rows = result.mappings().all()
    return [
        ReportDocumentResponse(
            **dict(row), download_url=f"/api/v1/reports/{row['id']}/download"
        )
        for row in rows
    ]


async def _mission_data(mission_id: UUID, user: AuthenticatedUser) -> dict[str, object]:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            text(
                """
                SELECT m.id AS mission_id, m.status, m.started_at, m.ended_at,
                       o.code AS occurrence_code, o.title AS occurrence_title,
                       COALESCE(o.organisation_id, d.organisation_id, c.organisation_id) AS organisation_id,
                       d.serial_number AS drone_serial,
                       c.gateway_sn AS controller_serial, p.full_name AS pilot_name,
                       COUNT(tp.id)::int AS telemetry_points,
                       MAX(tp.altitude_m) AS max_altitude_m,
                       MAX(tp.speed_mps) AS max_speed_mps,
                       MIN(tp.battery_percent) AS min_battery_percent
                FROM missions m
                LEFT JOIN occurrences o ON o.id = m.occurrence_id
                LEFT JOIN drones d ON d.id = m.drone_id
                LEFT JOIN controllers c ON c.id = m.controller_id
                LEFT JOIN users p ON p.id = m.pilot_id
                LEFT JOIN telemetry_points tp ON tp.mission_id = m.id
                WHERE m.id = :mission_id
                  AND (
                    :organisation_id IS NULL OR
                    COALESCE(o.organisation_id, d.organisation_id, c.organisation_id) = :organisation_id
                  )
                GROUP BY m.id, o.code, o.title, o.organisation_id,
                         d.organisation_id, c.organisation_id,
                         d.serial_number, c.gateway_sn, p.full_name
                """
            ),
            {"mission_id": mission_id, "organisation_id": user.organisation_id},
        )
        row = result.mappings().first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mission not found")
    data = dict(row)
    for key in ("max_altitude_m", "max_speed_mps", "min_battery_percent"):
        if data[key] is not None:
            data[key] = round(float(data[key]), 2)
    data["generated_at"] = datetime.now(timezone.utc).isoformat()
    return data


@router.post(
    "/missions/{mission_id}",
    response_model=ReportDocumentResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
)
async def generate_mission_report(
    mission_id: UUID,
    user: Annotated[AuthenticatedUser, Depends(require_roles(REPORT_ROLES))],
) -> ReportDocumentResponse:
    report_data = await _mission_data(mission_id, user)
    report_id = uuid4()
    try:
        pdf = await pdf_report_service.mission_report(report_data, str(report_id))
    except HTTPError as exc:
        logger.exception("PDF service failed", extra={"mission_id": str(mission_id)})
        raise HTTPException(status_code=503, detail="PDF generation service unavailable") from exc

    storage_key = f"reports/missions/{mission_id}/{report_id}.pdf"
    try:
        await run_in_threadpool(object_storage.put_pdf, storage_key, pdf)
    except (BotoCoreError, ClientError) as exc:
        logger.exception("Report storage failed", extra={"mission_id": str(mission_id)})
        raise HTTPException(status_code=503, detail="Object storage unavailable") from exc

    title = f"Relatório de missão {mission_id}"
    digest = hashlib.sha256(pdf).hexdigest()
    async with AsyncSessionLocal() as session, session.begin():
        result = await session.execute(
            text(
                """
                INSERT INTO report_documents (
                    id, organisation_id, mission_id, occurrence_id, report_type, title,
                    storage_bucket, storage_key, size_bytes, sha256, generated_by
                )
                SELECT :id, :organisation_id, m.id, m.occurrence_id, 'mission', :title,
                       :bucket, :storage_key, :size_bytes, :sha256, :generated_by
                FROM missions m WHERE m.id = :mission_id
                RETURNING id, mission_id, report_type, title, size_bytes, generated_at
                """
            ),
            {
                "id": report_id,
                "organisation_id": report_data["organisation_id"],
                "mission_id": mission_id,
                "title": title,
                "bucket": settings.s3_bucket,
                "storage_key": storage_key,
                "size_bytes": len(pdf),
                "sha256": digest,
                "generated_by": user.id,
            },
        )
        row = dict(result.mappings().one())
        await session.execute(
            text(
                """
                INSERT INTO audit_logs (
                    actor_user_id, organisation_id, action, entity_type, entity_id, metadata
                ) VALUES (
                    :actor_id, :organisation_id, 'report.generate',
                    'report_document', :entity_id,
                    jsonb_build_object('mission_id', :mission_id, 'sha256', :sha256)
                )
                """
            ),
            {
                "actor_id": user.id,
                "organisation_id": report_data["organisation_id"],
                "entity_id": str(report_id),
                "mission_id": str(mission_id),
                "sha256": digest,
            },
        )
    return ReportDocumentResponse(**row, download_url=f"/api/v1/reports/{report_id}/download")


@router.get("/{report_id}/download")
async def download_report(
    report_id: UUID,
    user: Annotated[AuthenticatedUser, Depends(require_roles(ALL_ROLES))],
) -> StreamingResponse:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            text(
                """
                SELECT organisation_id, storage_bucket, storage_key, title
                FROM report_documents
                WHERE id = :report_id
                  AND (:organisation_id IS NULL OR organisation_id = :organisation_id)
                """
            ),
            {"report_id": report_id, "organisation_id": user.organisation_id},
        )
        row = result.mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="Report not found")
    try:
        content = await run_in_threadpool(object_storage.get, row["storage_bucket"], row["storage_key"])
    except (BotoCoreError, ClientError) as exc:
        raise HTTPException(status_code=503, detail="Object storage unavailable") from exc
    filename = f"missao-{report_id}.pdf"
    return StreamingResponse(
        BytesIO(content),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/{report_id}/email", dependencies=[Depends(verify_csrf)])
async def email_report(
    report_id: UUID,
    payload: EmailReportRequest,
    user: Annotated[AuthenticatedUser, Depends(require_roles(REPORT_ROLES))],
) -> dict[str, str]:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            text(
                """
                SELECT organisation_id, storage_bucket, storage_key, title
                FROM report_documents
                WHERE id = :report_id
                  AND (:organisation_id IS NULL OR organisation_id = :organisation_id)
                """
            ),
            {"report_id": report_id, "organisation_id": user.organisation_id},
        )
        report = result.mappings().first()
    if report is None:
        raise HTTPException(status_code=404, detail="Report not found")

    recipients = [str(item) for item in dict.fromkeys(payload.recipients)]
    delivery_status = "sent"
    error_message = None
    failure_http_status = 502
    try:
        pdf = await run_in_threadpool(
            object_storage.get, report["storage_bucket"], report["storage_key"]
        )
        await email_service.send_report(
            recipients, payload.subject, payload.message, f"missao-{report_id}.pdf", pdf
        )
    except EmailNotConfiguredError as exc:
        delivery_status = "failed"
        error_message = str(exc)[:1000]
        failure_http_status = 503
    except (BotoCoreError, ClientError, aiosmtplib.SMTPException) as exc:
        delivery_status = "failed"
        error_message = str(exc)[:1000]
        logger.exception("Report email failed", extra={"report_id": str(report_id)})

    async with AsyncSessionLocal() as session, session.begin():
        await session.execute(
            text(
                """
                INSERT INTO email_deliveries (
                    organisation_id, report_document_id, sent_by, recipients,
                    subject, status, error_message
                ) VALUES (
                    :organisation_id, :report_id, :sent_by, :recipients,
                    :subject, :status, :error_message
                )
                """
            ),
            {
                "organisation_id": report["organisation_id"],
                "report_id": report_id,
                "sent_by": user.id,
                "recipients": recipients,
                "subject": payload.subject,
                "status": delivery_status,
                "error_message": error_message,
            },
        )
        await session.execute(
            text(
                """
                INSERT INTO audit_logs (
                    actor_user_id, organisation_id, action, entity_type, entity_id, metadata
                ) VALUES (
                    :actor_id, :organisation_id, 'report.email',
                    'report_document', :entity_id,
                    jsonb_build_object('status', :status, 'recipient_count', :recipient_count)
                )
                """
            ),
            {
                "actor_id": user.id,
                "organisation_id": report["organisation_id"],
                "entity_id": str(report_id),
                "status": delivery_status,
                "recipient_count": len(recipients),
            },
        )
    if delivery_status == "failed":
        detail = "SMTP is not configured" if failure_http_status == 503 else "Email delivery failed"
        raise HTTPException(status_code=failure_http_status, detail=detail)
    return {"status": "sent"}
