# Authentication and RBAC

Human access to `uas.ahbvc.org.pt` uses server-side sessions backed by:

- Argon2id password hashes.
- Short-lived JWT access tokens in `HttpOnly` cookies.
- Opaque refresh tokens stored in PostgreSQL only as SHA-256 hashes.
- Refresh-token rotation and logout revocation.
- `Secure`, `SameSite=Strict` cookies shared only with the UAS subdomains.
- Double-submit CSRF protection for state-changing requests.
- Redis login rate limiting.
- Database-backed role checks on every protected request.

Administrators do not define or email temporary passwords. New accounts remain
inactive until the recipient uses a random, single-use invitation link and
chooses a password. Invitation tokens expire after 24 hours by default and only
their SHA-256 hashes are stored in PostgreSQL.

DJI Pilot 2 opens the same institutional login. After a pilot authenticates, the
server authorizes the technical DJI configuration and records the operator,
controller and aircraft in a pilot session. No token is entered in the controller URL.

## Role matrix

| Area | Administrador | Operador | Piloto | Observador |
| --- | --- | --- | --- | --- |
| Dashboard | Yes | Yes | Yes | Yes |
| Flight history and telemetry | Yes | Yes | Yes | Yes |
| View livestream sources | Yes | Yes | Yes | Yes |
| Start or stop livestream | Yes | Yes | Yes | No |
| Manage users | Yes | No | No | No |
| System configuration | Yes | No | No | No |
| Use DJI Pilot 2 | Yes | No | Yes | No |

## Production activation

Apply the authentication migration before starting the new API image:

```bash
docker compose exec -T postgres sh -c \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < database/migrations/002_auth_sessions.sql

docker compose exec -T postgres sh -c \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < database/migrations/003_pilot_sessions.sql

docker compose exec -T postgres sh -c \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < database/migrations/005_user_invitations.sql
```

Users that were active before this migration remain active. The invitation
workflow applies to accounts created afterwards through the administration UI.

Create the initial administrator after rebuilding the API. The password is requested interactively and is not added to shell history:

```bash
docker compose exec api python -m app.cli.create_admin \
  --email admin@ahbvc.org.pt \
  --full-name "Nome do Administrador"
```

Create each pilot in the administration page with the `Piloto` role. The DJI
Pilot 2 Open Platform URL is clean and contains no credentials:

```text
https://pilot.uas.ahbvc.org.pt
```

## Credential rotation

Before production use, rotate the following values because earlier development versions exposed the Pilot bootstrap configuration without setup-token protection:

- `DJI_PILOT_API_TOKEN`
- `MQTT_PILOT_PASSWORD`

After changing the MQTT password, render the EMQX bootstrap file and recreate EMQX according to `docs/dji-pilot2-setup.md`.

The technical DJI and MQTT credentials remain server-side configuration and are
returned only to an authenticated `Piloto` or `Administrador` session.
