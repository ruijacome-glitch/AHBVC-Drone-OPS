# Implementation Phases

## Phase 1

Done in this scaffold.

## Phase 2

Base created, pending real DJI configuration:

- Pilot page exists.
- Backend namespace exists.
- MQTT topic helper exists.
- Gateway/drone registration placeholders exist.
- Official DJI auth payload validation is still pending.

## Phase 3

Next work after hardware is connected:

- Subscribe to DJI MQTT topics.
- Validate payloads against official docs and real messages.
- Persist telemetry to PostgreSQL/PostGIS.
- Add online/offline state transitions.

