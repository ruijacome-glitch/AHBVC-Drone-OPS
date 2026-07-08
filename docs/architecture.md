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

