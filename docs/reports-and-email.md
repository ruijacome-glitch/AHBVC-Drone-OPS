# Reports and email

AirSector generates mission PDFs through Gotenberg, an internal Docker
service based on Chromium. Gotenberg has no Traefik labels or published ports
and is reachable only from the Docker `internal` network.

The image is pinned to the Chromium-only variant because this phase generates
HTML reports. If Office document conversion is added later, change to the full
Gotenberg image after reviewing its additional resource requirements.

Generated documents are stored in MinIO and indexed in `report_documents`.
Every email attempt is recorded in `email_deliveries` without storing message
attachments in PostgreSQL.

## Production setup

Apply the migration:

```bash
docker compose exec -T postgres sh -c \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < database/migrations/004_reports_and_email.sql
```

Configure an authenticated SMTP account in `.env`:

```dotenv
SMTP_HOST=smtp.example.org
SMTP_PORT=587
SMTP_USERNAME=uas@example.org
SMTP_PASSWORD=<secret>
SMTP_FROM_EMAIL=uas@example.org
SMTP_FROM_NAME=AirSector | AHBVC
SMTP_START_TLS=true
SMTP_USE_TLS=false
```

For production, create a restricted MinIO service account and configure
`S3_ACCESS_KEY` and `S3_SECRET_KEY`. When omitted, the current MinIO root
credentials are used for backward compatibility during initial deployment.

Use `SMTP_START_TLS=true` for port 587. For implicit TLS on port 465, set
`SMTP_START_TLS=false` and `SMTP_USE_TLS=true`. Never enable both.

Recreate the services after changing configuration:

```bash
docker compose pull gotenberg
docker compose build api
docker compose up -d gotenberg api
```

## API

- `POST /api/v1/reports/missions/{mission_id}` generates and stores a PDF.
- `GET /api/v1/reports?mission_id={mission_id}` lists generated documents.
- `GET /api/v1/reports/{report_id}/download` downloads an authorized report.
- `POST /api/v1/reports/{report_id}/email` sends the stored PDF as an attachment.

Generation and email require `Administrador`, `Operador`, or `Piloto`.
Authenticated observers may download an existing report belonging to their
organisation.

The first template is `apps/api/app/templates/mission_report.html`. Further
templates should reuse the same PDF, storage, email, audit, and RBAC services.
