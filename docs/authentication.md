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

Tokens used by DJI Pilot 2 are separate from human sessions.

## Role matrix

| Area | Administrador | Operador | Piloto | Observador |
| --- | --- | --- | --- | --- |
| Dashboard | Yes | Yes | Yes | Yes |
| Flight history and telemetry | Yes | Yes | Yes | Yes |
| View livestream sources | Yes | Yes | Yes | Yes |
| Start or stop livestream | Yes | Yes | Yes | No |
| Manage users | Yes | No | No | No |
| System configuration | Yes | No | No | No |

## Production activation

Apply the authentication migration before starting the new API image:

```bash
docker compose exec -T postgres sh -c \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < database/migrations/002_auth_sessions.sql
```

Generate and add a separate DJI Pilot setup token to `.env`:

```bash
openssl rand -hex 32
```

```dotenv
DJI_PILOT_SETUP_TOKEN=<generated-value>
```

Create the initial administrator after rebuilding the API. The password is requested interactively and is not added to shell history:

```bash
docker compose exec api python -m app.cli.create_admin \
  --email admin@ahbvc.org.pt \
  --full-name "Nome do Administrador"
```

The DJI Pilot 2 Open Platform URL must then include the setup token:

```text
https://pilot.uas.ahbvc.org.pt/#setup_token=<DJI_PILOT_SETUP_TOKEN>
```

## Credential rotation

Before production use, rotate the following values because earlier development versions exposed the Pilot bootstrap configuration without setup-token protection:

- `DJI_PILOT_API_TOKEN`
- `MQTT_PILOT_PASSWORD`
- `DJI_PILOT_SETUP_TOKEN`

After changing the MQTT password, render the EMQX bootstrap file and recreate EMQX according to `docs/dji-pilot2-setup.md`.

The setup token is placed in the URL fragment (`#`) so it is not sent in HTTP requests or Traefik access logs. The Pilot page removes it from the visible URL after storing it for the current browser session.
