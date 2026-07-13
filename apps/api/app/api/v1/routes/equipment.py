from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.api.dependencies.auth import ALL_ROLES, OPERATIONS_WRITE_ROLES, AuthenticatedUser, require_roles
from app.api.v1.routes.auth import verify_csrf
from app.db.session import AsyncSessionLocal


router = APIRouter(prefix="/equipment", tags=["equipment"])
EquipmentType = Literal["drone", "controller", "payload"]


class EquipmentUpdateRequest(BaseModel):
    callsign: str | None = Field(default=None, max_length=80)
    display_name: str | None = Field(default=None, max_length=160)
    notes: str | None = Field(default=None, max_length=2000)
    status: str | None = Field(default=None, max_length=40)


def _equipment_row(row: object) -> dict[str, object]:
    values = dict(row)  # type: ignore[arg-type]
    return values


@router.get("", dependencies=[Depends(require_roles(ALL_ROLES))])
async def list_equipment(
    user: Annotated[AuthenticatedUser, Depends(require_roles(ALL_ROLES))],
) -> dict[str, list[dict[str, object]]]:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            text(
                """
                SELECT 'controller' AS equipment_type, c.id, c.gateway_sn AS serial_number,
                       c.callsign, c.display_name, c.model, c.online_status, c.last_seen_at,
                       NULL::uuid AS drone_id, NULL::text AS payload_type, NULL::text AS status,
                       c.notes
                FROM controllers c
                WHERE c.organisation_id = CAST(:organisation_id AS uuid)
                UNION ALL
                SELECT 'drone', d.id, d.serial_number, d.callsign, d.display_name, d.model,
                       d.online_status, d.last_seen_at, d.controller_id, NULL::text, NULL::text,
                       d.notes
                FROM drones d
                WHERE d.organisation_id = CAST(:organisation_id AS uuid)
                UNION ALL
                SELECT 'payload', p.id, COALESCE(p.serial_number, ''), p.callsign, p.display_name,
                       p.model, NULL::text, NULL::timestamptz, p.drone_id, p.payload_type, p.status,
                       p.notes
                FROM payloads p
                JOIN drones d ON d.id = p.drone_id
                WHERE d.organisation_id = CAST(:organisation_id AS uuid)
                ORDER BY equipment_type, display_name NULLS LAST, serial_number
                """
            ),
            {"organisation_id": user.organisation_id},
        )
        rows = [_equipment_row(row) for row in result.mappings().all()]
    return {"equipment": rows}


@router.patch("/{equipment_type}/{equipment_id}", dependencies=[Depends(verify_csrf)])
async def update_equipment(
    equipment_type: EquipmentType,
    equipment_id: UUID,
    payload: EquipmentUpdateRequest,
    user: Annotated[AuthenticatedUser, Depends(require_roles(OPERATIONS_WRITE_ROLES))],
) -> dict[str, object]:
    if equipment_type == "payload" and payload.status not in {None, "available", "in_use", "maintenance", "retired"}:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid payload status")
    if equipment_type != "payload" and payload.status is not None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Status is managed by telemetry")

    table = {"controller": "controllers", "drone": "drones", "payload": "payloads"}[equipment_type]
    fields = {"callsign": payload.callsign, "display_name": payload.display_name, "notes": payload.notes}
    if equipment_type == "payload":
        fields["status"] = payload.status
    assignments = ", ".join(f"{key} = :{key}" for key, value in fields.items() if value is not None)
    if not assignments:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No equipment changes supplied")

    async with AsyncSessionLocal() as session, session.begin():
        result = await session.execute(
            text(
                f"""
                UPDATE {table}
                SET {assignments}
                WHERE id = :equipment_id
                  AND {"organisation_id = CAST(:organisation_id AS uuid)" if equipment_type != "payload" else "drone_id IN (SELECT id FROM drones WHERE organisation_id = CAST(:organisation_id AS uuid))"}
                RETURNING id
                """
            ),
            {**{key: value for key, value in fields.items() if value is not None}, "equipment_id": equipment_id, "organisation_id": user.organisation_id},
        )
        if result.scalar_one_or_none() is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Equipment not found")
    return {"status": "updated", "equipment_type": equipment_type, "id": equipment_id}
