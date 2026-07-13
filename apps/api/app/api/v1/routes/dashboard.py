from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from sqlalchemy import text

from app.api.dependencies.auth import AuthenticatedUser, current_user
from app.db.session import AsyncSessionLocal
from app.services.dji_mqtt import dji_mqtt_consumer


router = APIRouter(prefix="/dashboard", tags=["dashboard"])


def _serialize_activity(row: Any) -> dict[str, object]:
    values = dict(row)
    occurred_at = values.get("occurred_at")
    if isinstance(occurred_at, datetime):
        values["occurred_at"] = occurred_at.isoformat().replace("+00:00", "Z")
    return values


@router.get("/summary")
async def dashboard_summary(
    user: Annotated[AuthenticatedUser, Depends(current_user)],
) -> dict[str, object]:
    """Return aggregate operational data without exposing aircraft telemetry."""
    async with AsyncSessionLocal() as session:
        counters = (
            await session.execute(
                text(
                    """
                    SELECT
                      (SELECT COUNT(*) FROM occurrences
                         WHERE status = 'active'
                           AND (:organisation_id IS NULL OR
                                organisation_id = :organisation_id)
                      ) AS active_occurrences,
                      (SELECT COUNT(*) FROM missions
                         WHERE status IN ('active', 'in_progress')
                           AND (:organisation_id IS NULL OR
                                organisation_id = :organisation_id)
                      ) AS active_missions,
                      (SELECT COUNT(*) FROM flight_tracks ft
                         LEFT JOIN missions m ON m.id = ft.mission_id
                         LEFT JOIN drones d ON d.id = ft.drone_id
                         WHERE ft.started_at >= date_trunc('day', now() AT TIME ZONE 'UTC')
                           AND (:organisation_id IS NULL OR COALESCE(
                                m.organisation_id, d.organisation_id
                           ) = :organisation_id)
                      ) AS flights_today,
                      (SELECT COUNT(*) FROM flight_tracks ft
                         LEFT JOIN missions m ON m.id = ft.mission_id
                         LEFT JOIN drones d ON d.id = ft.drone_id
                         WHERE :organisation_id IS NULL OR COALESCE(
                               m.organisation_id, d.organisation_id
                         ) = :organisation_id
                      ) AS total_flights,
                      (SELECT COUNT(*) FROM livestreams l
                         LEFT JOIN missions m ON m.id = l.mission_id
                         LEFT JOIN drones d ON d.id = l.drone_id
                         WHERE l.status = 'online'
                           AND (:organisation_id IS NULL OR COALESCE(
                                m.organisation_id, d.organisation_id
                           ) = :organisation_id)
                      ) AS active_streams
                    """
                ),
                {"organisation_id": user.organisation_id},
            )
        ).mappings().one()
        activities = (
            await session.execute(
                text(
                    """
                    SELECT activity_type, title, detail, occurred_at
                    FROM (
                      SELECT 'occurrence' AS activity_type,
                             'Ocorrência criada' AS title,
                             code || ' · ' || title AS detail,
                             started_at AS occurred_at,
                             organisation_id
                      FROM occurrences
                      UNION ALL
                      SELECT 'flight' AS activity_type,
                             'Voo registado' AS title,
                             CASE WHEN ended_at IS NULL
                               THEN 'Em curso' ELSE 'Concluído'
                             END AS detail,
                             ft.started_at AS occurred_at,
                             COALESCE(m.organisation_id, d.organisation_id) AS organisation_id
                      FROM flight_tracks ft
                      LEFT JOIN missions m ON m.id = ft.mission_id
                      LEFT JOIN drones d ON d.id = ft.drone_id
                      WHERE ft.started_at IS NOT NULL
                      UNION ALL
                      SELECT 'stream' AS activity_type,
                             'Livestream iniciado' AS title,
                             CASE WHEN status = 'online'
                               THEN 'Em direto' ELSE 'Terminado'
                             END AS detail,
                             l.started_at AS occurred_at,
                             COALESCE(m.organisation_id, d.organisation_id) AS organisation_id
                      FROM livestreams l
                      LEFT JOIN missions m ON m.id = l.mission_id
                      LEFT JOIN drones d ON d.id = l.drone_id
                      WHERE l.started_at IS NOT NULL
                    ) activity
                    WHERE :organisation_id IS NULL OR organisation_id = :organisation_id
                    ORDER BY occurred_at DESC
                    LIMIT 8
                    """
                ),
                {"organisation_id": user.organisation_id},
            )
        ).mappings().all()

    mqtt = dji_mqtt_consumer.snapshot()
    return {
        "counters": {key: int(value or 0) for key, value in counters.items()},
        "services": {
            "api": True,
            "database": True,
            "mqtt": bool(mqtt["connected"]),
        },
        "activity": [_serialize_activity(row) for row in activities],
        "generated_at": datetime.now().astimezone().isoformat(),
    }
