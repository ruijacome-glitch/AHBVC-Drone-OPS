# UAS Platform

Professional UAS operations platform for Bombeiros Voluntarios de Cascais, focused on DJI Enterprise aircraft through DJI Pilot 2 and the official DJI Cloud API.

## MVP Scope

The project is intentionally limited to Phase 1 and Phase 2.

Phase 1 included:
- Monorepo structure
- Docker Compose
- Traefik with HTTPS / Let's Encrypt wiring
- PostgreSQL + PostGIS
- Redis
- EMQX MQTT
- MediaMTX
- MinIO
- FastAPI backend
- React + Vite frontend
- Healthchecks
- Initial database schema
- `.env.example`

Phase 2 included as a conservative base:
- Pilot bootstrap page for `pilot.uas.ahbvc.org.pt`
- FastAPI DJI namespace
- MQTT topic helper for the requested DJI topic names
- Gateway/drone registration placeholders
- Pilot to Cloud topology endpoint
- Situation Awareness WebSocket base for DJI `ws` / `tsa`
- Explicit TODOs where official DJI Cloud API payloads must be validated

The backend does not pretend to implement undocumented DJI Pilot 2 authentication payloads. Those endpoints are guarded with TODOs until the DJI Developer Portal configuration and official Cloud API contract are confirmed.

## Fleet Assumptions

For DJI Cloud API, each DJI Pilot 2 remote controller is treated as a gateway.
The Matrice 30T operation may use two controllers, so the platform must support
two registered controller/gateway records and up to two drones connected at the
same time in the initial deployment.

Drone/controller association is mission-specific: the same aircraft can be used
with different controllers over time, but every active mission must record the
actual gateway/controller used.

## Domains

- `uas.ahbvc.org.pt` - web console
- `api.uas.ahbvc.org.pt` - FastAPI
- `mqtt.uas.ahbvc.org.pt` - EMQX dashboard and MQTT public hostname
- `stream.uas.ahbvc.org.pt` - MediaMTX
- `storage.uas.ahbvc.org.pt` - MinIO S3 API
- `pilot.uas.ahbvc.org.pt` - DJI Pilot 2 login/bootstrap page

## Local Start

```bash
cp .env.example .env
docker compose up --build
```

Then check:

```bash
curl http://localhost:8000/healthz
```

For production, point DNS records to the Hetzner CX23 server before starting Traefik with Let's Encrypt.

## Important DJI Rule

Do not invent DJI Cloud API endpoints or payloads.

When a request or response shape is unknown, keep a TODO that points to the official DJI Cloud API documentation:

https://developer.dji.com/doc/cloud-api-tutorial/en/

## Next Milestone

Before Phase 3, configure DJI Developer Portal and DJI Pilot 2 as described in [docs/dji-pilot2-setup.md](docs/dji-pilot2-setup.md).

Future phases include media management and a dedicated thermal analysis phase.
Temperature values must only be extracted from original DJI radiometric thermal
files or validated thermal metadata; colorized thermal images are not enough for
reliable temperature readings.

## Documentation

- [Architecture](docs/architecture.md)
- [DJI Pilot 2 setup](docs/dji-pilot2-setup.md)
- [Authentication and RBAC](docs/authentication.md)
- [Implementation phases](docs/phases.md)
