# Architecture

## Services

- FastAPI receives platform API traffic and hosts the DJI Cloud API integration surface.
- EMQX receives MQTT traffic from DJI Pilot 2 / gateway devices after official setup.
- PostgreSQL + PostGIS stores fleet, occurrence, mission, telemetry, media, and audit data.
- Redis is reserved for sessions, rate limits, async state, and future workers.
- MediaMTX receives RTMP and exposes WebRTC/HLS in later phases.
- MinIO stores media uploaded through DJI Cloud API media workflows in later phases.
- Traefik terminates HTTPS and routes each subdomain.

## Current Boundary

Phase 1 and Phase 2 stop before real MQTT ingestion and real DJI media/stream workflows. The only DJI-specific behavior currently included is configuration bootstrap, topic listing, and placeholders for registration/authentication.

DJI Pilot 2 remote controllers are modeled as gateways. A Matrice 30T operation
can have two controllers, so controller identity must remain separate from drone
identity in telemetry, missions, streams, media, and audit logs.

## Data Model

The initial SQL migration creates:

- users
- roles
- organisations
- drones
- controllers
- payloads
- missions
- occurrences
- flight_tracks
- telemetry_points
- media_files
- livestreams
- map_markers
- audit_logs

Telemetry positions use PostGIS geography points, and flight tracks use a 3D LineString geometry.

## Thermal Media Boundary

Thermal analysis is planned after media management. The platform must store the
original DJI thermal file in MinIO before any processing. Temperature extraction
is only valid when the source file contains radiometric data or DJI thermal
metadata that has been validated against official DJI tooling and real captures.

Derived thermal analysis should be stored separately from `media_files`, for
example as a future `thermal_analyses` table linked to:

- media file
- occurrence
- mission
- drone
- controller/gateway
- map marker, when GPS metadata exists

Expected derived fields include minimum temperature, maximum temperature,
average temperature, hotspot pixel, coldspot pixel, thermal scale, measurement
settings, and a clear accuracy/TODO note until DJI thermal assumptions are fully
validated.
