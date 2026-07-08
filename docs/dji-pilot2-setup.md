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
   - Workspace ID or equivalent workspace identifier used by the Cloud API
4. Add the production domains:
   - `https://pilot.uas.ahbvc.org.pt`
   - `https://api.uas.ahbvc.org.pt`
5. Confirm the exact login/authentication callback contract required by DJI Pilot 2.
6. Confirm the exact MQTT authentication mechanism expected by Pilot 2.
7. Confirm TLS/certificate requirements for MQTT on `mqtt.uas.ahbvc.org.pt:8883`.
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
mqtt.uas.ahbvc.org.pt:8883
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

## Do Not Start Phase 3 Until

- Pilot 2 opens `pilot.uas.ahbvc.org.pt`.
- The API healthcheck is green.
- DJI Developer Portal credentials are in `.env`.
- MQTT TLS connection succeeds from Pilot 2.
- At least one gateway/controller serial is known.
- The first MQTT packet is visible in EMQX logs or dashboard.

