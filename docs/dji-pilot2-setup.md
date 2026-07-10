# DJI Developer Portal and DJI Pilot 2 Setup

Official documentation reference:

https://developer.dji.com/doc/cloud-api-tutorial/en/

## What Still Must Be Configured

### DJI Developer Portal

1. Create or select the DJI Cloud API application for AHBVC.
2. Confirm that the application supports DJI Pilot 2 Cloud Services / Open Platform.
3. Record the official application credentials:
   - App ID
   - App Key
   - App Secret
   - App Basic License
   - Workspace ID as a UUID used by the Cloud API JSBridge
4. Add the production domains:
   - `https://pilot.uas.ahbvc.org.pt`
   - `https://api.uas.ahbvc.org.pt`
5. Confirm the exact login/authentication callback contract required by DJI Pilot 2.
6. Confirm the exact MQTT authentication mechanism expected by Pilot 2.
7. Confirm whether the DJI Pilot 2 Cloud Module must use `tcp://` or `ws://`.
   The official JSBridge Cloud Module reference states that the MQTT URL in
   Pilot 2 needs to use `tcp://` or `ws://`, with an example like
   `tcp://xx.xx.xx.xx:xxx`.
8. Confirm whether DJI expects any allowlisted callback URLs for media, livestream, or device events.

### Server DNS and TLS

Create DNS records pointing to the Hetzner CX23 public IP:

- `uas.ahbvc.org.pt`
- `api.uas.ahbvc.org.pt`
- `mqtt.uas.ahbvc.org.pt`
- `stream.uas.ahbvc.org.pt`
- `storage.uas.ahbvc.org.pt`
- `pilot.uas.ahbvc.org.pt`

Then set:

```env
ROOT_DOMAIN=uas.ahbvc.org.pt
LETSENCRYPT_EMAIL=<AHBVC technical email>
```

For the DJI Pilot 2 Cloud Module MQTT `tcp://` test, allow TCP port 1883 on
the VPS firewall:

```bash
ufw allow 1883/tcp
```

### DJI Pilot 2

In DJI Pilot 2:

1. Open Cloud Services / Open Platform.
2. Configure the platform URL as:

```text
https://pilot.uas.ahbvc.org.pt
```

3. Confirm Pilot 2 can open the page and load bootstrap data from:

```text
https://api.uas.ahbvc.org.pt/api/v1/dji/pilot/bootstrap
```

4. Configure MQTT using the official DJI Cloud API instructions after validating credentials:

```text
tcp://mqtt.uas.ahbvc.org.pt:1883
```

5. Test with one controller/gateway first.
6. Only after the first gateway appears online, test the second drone/controller path.

## Current TODOs in Code

- `apps/api/app/api/v1/routes/dji.py`
  - Validate Pilot 2 auth payloads.
  - Validate expected bootstrap response shape.
  - Validate gateway/drone registration source of truth.
- `infrastructure/emqx/acl.conf`
  - Replace development ACLs with least-privilege DJI topic ACLs.

## Local Credentials

The DJI app has been created in the Developer Portal as a Cloud API app. Store real values only in the local `.env` file or in the production secret store.

Required variables:

```env
DJI_APP_ID=
DJI_APP_KEY=
DJI_APP_SECRET=
DJI_APP_BASIC_LICENSE=
DJI_WORKSPACE_ID=<uuid>
DJI_PILOT_API_TOKEN=<long-random-token>
MQTT_PILOT_USERNAME=pilot
MQTT_PILOT_PASSWORD=<long-random-password>
MQTT_PUBLIC_URL=tcp://mqtt.uas.ahbvc.org.pt:1883
```

Do not commit the real App Key, App Secret, or Basic License.
Do not commit the generated EMQX bootstrap CSV. It is ignored by Git.

Generate values on the VPS with:

```bash
uuidgen
openssl rand -hex 32
openssl rand -hex 24
```

After updating `.env` on the VPS, render the EMQX MQTT user bootstrap file:

```bash
bash scripts/render-emqx-mqtt-users.sh
docker compose up -d --force-recreate emqx
docker compose ps emqx
```

The bootstrap file seeds the `MQTT_PILOT_USERNAME` and `MQTT_PILOT_PASSWORD`
values into EMQX built-in database authentication. If EMQX was already running
with a persisted data volume, confirm the user exists in the EMQX dashboard at
`https://mqtt.uas.ahbvc.org.pt` before testing DJI Pilot 2.
The generated file is readable by the EMQX container and remains ignored by Git.

External MQTT smoke test from the VPS:

```bash
MQTT_PILOT_USERNAME="$(grep -E '^MQTT_PILOT_USERNAME=' .env | tail -n 1 | cut -d= -f2-)"
MQTT_PILOT_PASSWORD="$(grep -E '^MQTT_PILOT_PASSWORD=' .env | tail -n 1 | cut -d= -f2-)"
docker run --rm eclipse-mosquitto:2 mosquitto_sub \
  -h mqtt.uas.ahbvc.org.pt \
  -p 1883 \
  -u "${MQTT_PILOT_USERNAME}" \
  -P "${MQTT_PILOT_PASSWORD}" \
  -t "thing/product/test/osd" \
  -C 1 \
  -W 10
```

In another SSH session, publish a test message:

```bash
MQTT_PILOT_USERNAME="$(grep -E '^MQTT_PILOT_USERNAME=' .env | tail -n 1 | cut -d= -f2-)"
MQTT_PILOT_PASSWORD="$(grep -E '^MQTT_PILOT_PASSWORD=' .env | tail -n 1 | cut -d= -f2-)"
docker run --rm eclipse-mosquitto:2 mosquitto_pub \
  -h mqtt.uas.ahbvc.org.pt \
  -p 1883 \
  -u "${MQTT_PILOT_USERNAME}" \
  -P "${MQTT_PILOT_PASSWORD}" \
  -t "thing/product/test/osd" \
  -m '{"test":true}'
```

The DJI Quick Start states that App ID, App Key and App License are copied into the
front-end configuration so the H5 page can call `window.djiBridge.platformVerifyLicense`.
This platform serves those values only through the Pilot JSBridge config endpoint and
does not expose `DJI_APP_SECRET` to the browser.

## Situation Awareness WebSocket

The MVP exposes a minimal authenticated WebSocket for DJI Pilot 2 Situation
Awareness:

```text
wss://api.uas.ahbvc.org.pt/manage/api/v1/workspaces/<workspace-id>/websocket
```

The Pilot JSBridge config endpoint returns this URL as `ws_host`. The frontend
passes the Pilot API token separately when loading the DJI `ws` module, then
loads the `tsa` module.

Current limitation:

```text
TODO(DJI Cloud API): emit device_osd, device_online, device_offline and
device_update_topo only after validating the official DJI message schemas and
testing with the real controller/drone.
```

Useful VPS checks during the Pilot 2 test:

```bash
cd /opt/uas-platform
docker compose logs -f api emqx
```

```bash
cd /opt/uas-platform
docker compose exec emqx /opt/emqx/bin/emqx ctl clients list
```

## Do Not Start Phase 3 Until

- Pilot 2 opens `pilot.uas.ahbvc.org.pt`.
- The API healthcheck is green.
- DJI Developer Portal credentials are in `.env`.
- MQTT `tcp://` connection succeeds from Pilot 2.
- The DJI `ws` and `tsa` modules load without an immediate JSBridge error.
- At least one gateway/controller serial is known.
- The first MQTT packet is visible in EMQX logs or dashboard.
