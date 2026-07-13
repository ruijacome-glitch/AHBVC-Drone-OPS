import json
from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import text

from app.api.dependencies.auth import (
    ALL_ROLES,
    OPERATIONS_WRITE_ROLES,
    AuthenticatedUser,
    require_roles,
)
from app.api.v1.routes.auth import verify_csrf
from app.db.session import AsyncSessionLocal


router = APIRouter(prefix="/operations", tags=["operations"])


class CreateOccurrenceRequest(BaseModel):
    code: str = Field(min_length=2, max_length=80, pattern=r"^[A-Za-z0-9._/-]+$")
    title: str = Field(min_length=3, max_length=200)
    address: str | None = Field(default=None, max_length=300)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    started_at: datetime | None = None

    @model_validator(mode="after")
    def validate_location(self) -> "CreateOccurrenceRequest":
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("Latitude and longitude must be provided together")
        return self


class OccurrenceResponse(BaseModel):
    id: UUID
    code: str
    title: str
    status: str
    address: str | None
    latitude: float | None
    longitude: float | None
    external_source: str | None
    external_id: str | None
    started_at: datetime
    ended_at: datetime | None
    mission_count: int


class CreateMissionRequest(BaseModel):
    title: str = Field(min_length=3, max_length=160)
    objective: str = Field(min_length=3, max_length=2000)
    occurrence_id: UUID | None = None
    operational_area: str | None = Field(default=None, max_length=1000)
    is_training: bool = False
    drone_id: UUID | None = None
    controller_id: UUID | None = None
    pilot_id: UUID | None = None

    @model_validator(mode="after")
    def validate_occurrence(self) -> "CreateMissionRequest":
        if self.occurrence_id is None and not self.is_training:
            raise ValueError("An occurrence is required unless this is a training mission")
        return self


class MissionResponse(BaseModel):
    id: UUID
    occurrence_id: UUID | None
    occurrence_code: str | None
    occurrence_title: str | None
    title: str
    objective: str
    operational_area: str | None
    is_training: bool
    status: str
    drone_id: UUID | None
    controller_id: UUID | None
    pilot_id: UUID | None
    pilot_name: str | None
    started_at: datetime | None
    ended_at: datetime | None
    created_at: datetime
    flight_count: int


class CreateFlightRequest(BaseModel):
    notes: str | None = Field(default=None, max_length=2000)


class UpdateFlightStatusRequest(BaseModel):
    status: Literal["active", "completed", "aborted"]
    reason: str | None = Field(default=None, max_length=500)


class FlightResponse(BaseModel):
    id: UUID
    mission_id: UUID
    sequence_number: int
    status: str
    notes: str | None
    started_at: datetime | None
    ended_at: datetime | None
    created_at: datetime


def _tenant_required(user: AuthenticatedUser) -> UUID:
    if user.organisation_id is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Select an organisation before changing operational data",
        )
    return user.organisation_id


async def _audit(
    session,
    user: AuthenticatedUser,
    action: str,
    entity_type: str,
    entity_id: UUID,
    metadata: dict[str, object] | None = None,
) -> None:
    await session.execute(
        text(
            """
            INSERT INTO audit_logs (
              actor_user_id, organisation_id, action, entity_type, entity_id, metadata
            ) VALUES (
              :actor_id, :organisation_id, :action, :entity_type, :entity_id,
              CAST(:metadata AS jsonb)
            )
            """
        ),
        {
            "actor_id": user.id,
            "organisation_id": user.organisation_id,
            "action": action,
            "entity_type": entity_type,
            "entity_id": str(entity_id),
            "metadata": json.dumps(metadata or {}),
        },
    )


OCCURRENCE_SELECT = """
    SELECT o.id, o.code, o.title, o.status, o.address,
           ST_Y(o.location::geometry) AS latitude,
           ST_X(o.location::geometry) AS longitude,
           o.external_source, o.external_id, o.started_at, o.ended_at,
           COUNT(m.id)::int AS mission_count
    FROM occurrences o
    LEFT JOIN missions m ON m.occurrence_id = o.id
"""


MISSION_SELECT = """
    SELECT m.id, m.occurrence_id, o.code AS occurrence_code,
           o.title AS occurrence_title,
           COALESCE(m.title, 'Missão sem título') AS title,
           COALESCE(m.objective, '') AS objective,
           m.operational_area, m.is_training, m.status, m.drone_id,
           m.controller_id, m.pilot_id, u.full_name AS pilot_name,
           m.started_at, m.ended_at, m.created_at,
           COUNT(f.id)::int AS flight_count
    FROM missions m
    LEFT JOIN occurrences o ON o.id = m.occurrence_id
    LEFT JOIN users u ON u.id = m.pilot_id
    LEFT JOIN flights f ON f.mission_id = m.id
"""


@router.get("/occurrences", response_model=list[OccurrenceResponse])
async def list_occurrences(
    user: Annotated[AuthenticatedUser, Depends(require_roles(ALL_ROLES))],
) -> list[OccurrenceResponse]:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            text(
                OCCURRENCE_SELECT
                + """
                WHERE (CAST(:organisation_id AS uuid) IS NULL OR
                       o.organisation_id = CAST(:organisation_id AS uuid))
                GROUP BY o.id
                ORDER BY (o.status = 'active') DESC, o.started_at DESC
                """
            ),
            {"organisation_id": user.organisation_id},
        )
        return [OccurrenceResponse(**dict(row)) for row in result.mappings().all()]


@router.post(
    "/occurrences",
    response_model=OccurrenceResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
)
async def create_occurrence(
    payload: CreateOccurrenceRequest,
    user: Annotated[AuthenticatedUser, Depends(require_roles(OPERATIONS_WRITE_ROLES))],
) -> OccurrenceResponse:
    organisation_id = _tenant_required(user)
    async with AsyncSessionLocal() as session, session.begin():
        created = await session.execute(
            text(
                """
                INSERT INTO occurrences (
                  organisation_id, code, title, address, location, started_at
                ) VALUES (
                  :organisation_id, upper(:code), :title, :address,
                  CASE WHEN CAST(:latitude AS double precision) IS NULL THEN NULL
                    ELSE ST_SetSRID(ST_MakePoint(
                      CAST(:longitude AS double precision),
                      CAST(:latitude AS double precision)
                    ), 4326)::geography
                  END,
                  COALESCE(:started_at, now())
                )
                RETURNING id
                """
            ),
            {
                "organisation_id": organisation_id,
                "code": payload.code.strip(),
                "title": payload.title.strip(),
                "address": payload.address.strip() if payload.address else None,
                "latitude": payload.latitude,
                "longitude": payload.longitude,
                "started_at": payload.started_at,
            },
        )
        occurrence_id = created.scalar_one()
        await _audit(session, user, "occurrence.create", "occurrence", occurrence_id)
        result = await session.execute(
            text(OCCURRENCE_SELECT + " WHERE o.id = :id GROUP BY o.id"),
            {"id": occurrence_id},
        )
        return OccurrenceResponse(**dict(result.mappings().one()))


@router.get("/missions", response_model=list[MissionResponse])
async def list_missions(
    user: Annotated[AuthenticatedUser, Depends(require_roles(ALL_ROLES))],
) -> list[MissionResponse]:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            text(
                MISSION_SELECT
                + """
                WHERE (CAST(:organisation_id AS uuid) IS NULL OR
                       m.organisation_id = CAST(:organisation_id AS uuid))
                GROUP BY m.id, o.id, u.id
                ORDER BY (m.status IN ('active', 'ready')) DESC, m.created_at DESC
                """
            ),
            {"organisation_id": user.organisation_id},
        )
        return [MissionResponse(**dict(row)) for row in result.mappings().all()]


@router.post(
    "/missions",
    response_model=MissionResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
)
async def create_mission(
    payload: CreateMissionRequest,
    user: Annotated[AuthenticatedUser, Depends(require_roles(OPERATIONS_WRITE_ROLES))],
) -> MissionResponse:
    organisation_id = _tenant_required(user)
    async with AsyncSessionLocal() as session, session.begin():
        if payload.occurrence_id:
            occurrence = await session.execute(
                text(
                    """
                    SELECT id FROM occurrences
                    WHERE id = :id AND organisation_id = CAST(:organisation_id AS uuid)
                    """
                ),
                {"id": payload.occurrence_id, "organisation_id": organisation_id},
            )
            if occurrence.scalar_one_or_none() is None:
                raise HTTPException(status_code=404, detail="Occurrence not found")

        resources = await session.execute(
            text(
                """
                SELECT
                  (:drone_id IS NULL OR EXISTS (
                    SELECT 1 FROM drones
                    WHERE id = :drone_id AND organisation_id = CAST(:organisation_id AS uuid)
                  )) AS drone_ok,
                  (:controller_id IS NULL OR EXISTS (
                    SELECT 1 FROM controllers
                    WHERE id = :controller_id AND organisation_id = CAST(:organisation_id AS uuid)
                  )) AS controller_ok,
                  (:pilot_id IS NULL OR EXISTS (
                    SELECT 1 FROM users
                    WHERE id = :pilot_id AND organisation_id = CAST(:organisation_id AS uuid)
                  )) AS pilot_ok
                """
            ),
            {
                "organisation_id": organisation_id,
                "drone_id": payload.drone_id,
                "controller_id": payload.controller_id,
                "pilot_id": payload.pilot_id,
            },
        )
        if not all(resources.mappings().one().values()):
            raise HTTPException(status_code=404, detail="Assigned resource not found")

        created = await session.execute(
            text(
                """
                INSERT INTO missions (
                  organisation_id, occurrence_id, title, objective, operational_area,
                  is_training, drone_id, controller_id, pilot_id, status
                ) VALUES (
                  :organisation_id, :occurrence_id, :title, :objective, :operational_area,
                  :is_training, :drone_id, :controller_id, :pilot_id, 'draft'
                )
                RETURNING id
                """
            ),
            {
                "organisation_id": organisation_id,
                "occurrence_id": payload.occurrence_id,
                "title": payload.title.strip(),
                "objective": payload.objective.strip(),
                "operational_area": (
                    payload.operational_area.strip() if payload.operational_area else None
                ),
                "is_training": payload.is_training,
                "drone_id": payload.drone_id,
                "controller_id": payload.controller_id,
                "pilot_id": payload.pilot_id,
            },
        )
        mission_id = created.scalar_one()
        await session.execute(
            text(
                """
                INSERT INTO mission_events (
                  organisation_id, mission_id, actor_user_id, event_type, to_status
                ) VALUES (
                  :organisation_id, :mission_id, :actor_id, 'mission.created', 'draft'
                )
                """
            ),
            {
                "organisation_id": organisation_id,
                "mission_id": mission_id,
                "actor_id": user.id,
            },
        )
        await _audit(session, user, "mission.create", "mission", mission_id)
        result = await session.execute(
            text(MISSION_SELECT + " WHERE m.id = :id GROUP BY m.id, o.id, u.id"),
            {"id": mission_id},
        )
        return MissionResponse(**dict(result.mappings().one()))


@router.get("/missions/{mission_id}/flights", response_model=list[FlightResponse])
async def list_flights(
    mission_id: UUID,
    user: Annotated[AuthenticatedUser, Depends(require_roles(ALL_ROLES))],
) -> list[FlightResponse]:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            text(
                """
                SELECT f.id, f.mission_id, f.sequence_number, f.status, f.notes,
                       f.started_at, f.ended_at, f.created_at
                FROM flights f
                WHERE f.mission_id = :mission_id
                  AND (CAST(:organisation_id AS uuid) IS NULL OR
                       f.organisation_id = CAST(:organisation_id AS uuid))
                ORDER BY f.sequence_number
                """
            ),
            {"mission_id": mission_id, "organisation_id": user.organisation_id},
        )
        return [FlightResponse(**dict(row)) for row in result.mappings().all()]


@router.post(
    "/missions/{mission_id}/flights",
    response_model=FlightResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
)
async def create_flight(
    mission_id: UUID,
    payload: CreateFlightRequest,
    user: Annotated[AuthenticatedUser, Depends(require_roles(OPERATIONS_WRITE_ROLES))],
) -> FlightResponse:
    organisation_id = _tenant_required(user)
    async with AsyncSessionLocal() as session, session.begin():
        mission = await session.execute(
            text(
                """
                SELECT id, drone_id, controller_id, pilot_id
                FROM missions
                WHERE id = :id AND organisation_id = CAST(:organisation_id AS uuid)
                FOR UPDATE
                """
            ),
            {"id": mission_id, "organisation_id": organisation_id},
        )
        mission_row = mission.mappings().first()
        if mission_row is None:
            raise HTTPException(status_code=404, detail="Mission not found")
        created = await session.execute(
            text(
                """
                INSERT INTO flights (
                  organisation_id, mission_id, sequence_number, drone_id,
                  controller_id, pilot_id, notes
                ) VALUES (
                  :organisation_id, :mission_id,
                  (SELECT COALESCE(MAX(sequence_number), 0) + 1
                     FROM flights WHERE mission_id = :mission_id),
                  :drone_id, :controller_id, :pilot_id, :notes
                )
                RETURNING id, mission_id, sequence_number, status, notes,
                          started_at, ended_at, created_at
                """
            ),
            {
                "organisation_id": organisation_id,
                "mission_id": mission_id,
                "drone_id": mission_row["drone_id"],
                "controller_id": mission_row["controller_id"],
                "pilot_id": mission_row["pilot_id"],
                "notes": payload.notes.strip() if payload.notes else None,
            },
        )
        row = created.mappings().one()
        await session.execute(
            text(
                """
                INSERT INTO mission_events (
                  organisation_id, mission_id, actor_user_id, event_type, metadata
                ) VALUES (
                  :organisation_id, :mission_id, :actor_id, 'flight.created',
                  jsonb_build_object(
                    'flight_id', CAST(:flight_id AS text),
                    'sequence', CAST(:sequence AS integer)
                  )
                )
                """
            ),
            {
                "organisation_id": organisation_id,
                "mission_id": mission_id,
                "actor_id": user.id,
                "flight_id": str(row["id"]),
                "sequence": row["sequence_number"],
            },
        )
        await _audit(
            session,
            user,
            "flight.create",
            "flight",
            row["id"],
            {"mission_id": str(mission_id), "sequence": row["sequence_number"]},
        )
        return FlightResponse(**dict(row))


@router.patch(
    "/flights/{flight_id}/status",
    response_model=FlightResponse,
    dependencies=[Depends(verify_csrf)],
)
async def update_flight_status(
    flight_id: UUID,
    payload: UpdateFlightStatusRequest,
    user: Annotated[AuthenticatedUser, Depends(require_roles(OPERATIONS_WRITE_ROLES))],
) -> FlightResponse:
    organisation_id = _tenant_required(user)
    async with AsyncSessionLocal() as session, session.begin():
        flight_result = await session.execute(
            text(
                """
                SELECT f.id, f.mission_id, f.sequence_number, f.status, f.notes,
                       f.started_at, f.ended_at, f.created_at,
                       f.drone_id, f.controller_id, m.status AS mission_status
                FROM flights f
                JOIN missions m ON m.id = f.mission_id
                WHERE f.id = :flight_id
                  AND f.organisation_id = CAST(:organisation_id AS uuid)
                FOR UPDATE
                """
            ),
            {"flight_id": flight_id, "organisation_id": organisation_id},
        )
        flight = flight_result.mappings().first()
        if flight is None:
            raise HTTPException(status_code=404, detail="Flight not found")

        current_status = flight["status"]
        requested_status = payload.status
        valid_transitions = {
            "planned": {"active"},
            "active": {"completed", "aborted"},
            "completed": set(),
            "aborted": set(),
        }
        if requested_status not in valid_transitions[current_status]:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Cannot change flight from {current_status} to {requested_status}",
            )

        if requested_status == "active":
            active = await session.execute(
                text(
                    """
                    SELECT id FROM flights
                    WHERE organisation_id = CAST(:organisation_id AS uuid)
                      AND status = 'active'
                      AND id <> :flight_id
                      AND (drone_id = :drone_id OR controller_id = :controller_id)
                    LIMIT 1
                    """
                ),
                {
                    "organisation_id": organisation_id,
                    "flight_id": flight_id,
                    "drone_id": flight["drone_id"],
                    "controller_id": flight["controller_id"],
                },
            )
            if active.scalar_one_or_none() is not None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="The assigned drone or controller already has an active flight",
                )

        if requested_status == "active":
            updated = await session.execute(
                text(
                    """
                    UPDATE flights
                    SET status = 'active', started_at = COALESCE(started_at, now()),
                        updated_at = now()
                    WHERE id = :flight_id
                    RETURNING id, mission_id, sequence_number, status, notes,
                              started_at, ended_at, created_at
                    """
                ),
                {"flight_id": flight_id},
            )
            await session.execute(
                text(
                    """
                    UPDATE missions
                    SET status = 'active', started_at = COALESCE(started_at, now()),
                        updated_at = now()
                    WHERE id = :mission_id
                    """
                ),
                {"mission_id": flight["mission_id"]},
            )
            await session.execute(
                text(
                    """
                    UPDATE flight_tracks
                    SET flight_id = :flight_id
                    WHERE flight_id IS NULL AND drone_id = :drone_id AND ended_at IS NULL
                    """
                ),
                {"flight_id": flight_id, "drone_id": flight["drone_id"]},
            )
        else:
            updated = await session.execute(
                text(
                    """
                    UPDATE flights
                    SET status = :status, ended_at = COALESCE(ended_at, now()),
                        updated_at = now()
                    WHERE id = :flight_id
                    RETURNING id, mission_id, sequence_number, status, notes,
                              started_at, ended_at, created_at
                    """
                ),
                {"flight_id": flight_id, "status": requested_status},
            )
            remaining = await session.execute(
                text(
                    """
                    SELECT COUNT(*) FROM flights
                    WHERE mission_id = :mission_id AND status IN ('planned', 'active')
                    """
                ),
                {"mission_id": flight["mission_id"]},
            )
            if remaining.scalar_one() == 0:
                await session.execute(
                    text(
                        """
                        UPDATE missions
                        SET status = :mission_status, ended_at = COALESCE(ended_at, now()),
                            updated_at = now()
                        WHERE id = :mission_id
                        """
                    ),
                    {
                        "mission_id": flight["mission_id"],
                        "mission_status": "aborted" if requested_status == "aborted" else "completed",
                    },
                )

        await session.execute(
            text(
                """
                INSERT INTO mission_events (
                  organisation_id, mission_id, actor_user_id, event_type,
                  from_status, to_status, reason, metadata
                ) VALUES (
                  CAST(:organisation_id AS uuid), :mission_id, :actor_id, 'flight.status_changed',
                  :from_status, :to_status, :reason,
                  jsonb_build_object('flight_id', CAST(:flight_id AS text))
                )
                """
            ),
            {
                "organisation_id": organisation_id,
                "mission_id": flight["mission_id"],
                "actor_id": user.id,
                "from_status": current_status,
                "to_status": requested_status,
                "reason": payload.reason,
                "flight_id": str(flight_id),
            },
        )
        await _audit(
            session,
            user,
            f"flight.{requested_status}",
            "flight",
            flight_id,
            {"mission_id": str(flight["mission_id"]), "reason": payload.reason},
        )
        return FlightResponse(**dict(updated.mappings().one()))
