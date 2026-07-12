# Implementation Phases

## Phase 1

Done in this scaffold.

## Phase 2

Base created and validated with DJI Pilot 2 as far as possible without the
aircraft connected:

- Pilot page exists.
- Backend namespace exists.
- MQTT topic helper exists.
- Gateway/drone registration placeholders exist.
- Pilot 2 can load platform configuration.
- Pilot to Cloud topology endpoint exists.
- Situation Awareness WebSocket exists.
- DJI `ws` / `tsa` module loading is prepared.
- Official DJI payload validation remains pending for data that requires real
  controller/drone messages.

Operational model:

- Treat each DJI Pilot 2 remote controller as a gateway.
- The Matrice 30T setup may have two controllers; both must be registered as
  separate `controllers` / `gateway_sn` records.
- A drone can be associated with a different controller over time, but each
  active mission must record the controller/gateway used for that flight.

## Phase 3

Next work after hardware is connected:

- Subscribe to DJI MQTT topics.
- Validate payloads against official docs and real messages.
- Persist telemetry to PostgreSQL/PostGIS.
- Add online/offline state transitions.
- Register real controller/gateway serials.
- Register real drone serials.
- Support up to two simultaneously connected drones/controllers for the first
  deployment.

## Phase 4

Frontend real-time map:

- Use MapLibre with live drone position.
- Show heading, trail, altitude, battery, speed, online/offline state, and
  active occurrence.
- Keep controller/gateway identity visible when more than one command is active.

## Phase 5

Streaming:

- Receive RTMP from DJI Pilot 2 through MediaMTX.
- Expose WebRTC in browser and HLS fallback.
- Associate each livestream with occurrence, mission, drone, and controller.

## Phase 5.5

External Stream Sharing:

- Generate one read-only invitation for all active drone streams associated
  with an occurrence or mission, with optional selection of individual streams.
- Share the invitation as a QR code, by email, or by SMS.
- Use an opaque, expiring and revocable token; store only its hash.
- Exchange the invitation token for a short-lived viewer session and remove it
  from the browser address before loading any stream.
- Show WebRTC first and use HLS as fallback, including clear offline and
  reconnecting states for each drone.
- Never expose DJI credentials, MQTT credentials, MediaMTX publication keys, or
  internal stream URLs to external viewers.
- Audit invitation creation, access, revocation and delivery attempts without
  storing raw tokens or unnecessary recipient data.
- Permit stream invitation creation and revocation only to authorized internal
  roles. Initial policy: Administrator and Operator.
- Reuse the configured SMTP service for email delivery.
- Add an SMS provider interface and implement the Preventech adapter only from
  its official API documentation and real request/response examples.
- TODO(Preventech SMS): confirm base URL, authentication, endpoint, sender
  restrictions, request/response schema, delivery receipt webhook, rate limits,
  sandbox and production credentials. Do not invent this contract.

## Phase 6

Media Management:

- Integrate DJI Cloud API media upload flow after validating official payloads.
- Store original photos and videos in MinIO.
- Associate media with mission, occurrence, drone, controller, and map marker.

## Phase 6.5

Thermal Analysis:

- Detect DJI thermal media from Matrice 30T / Matrice 4T.
- Preserve original radiometric thermal files; do not convert/destructively
  process before analysis.
- Extract temperature values only from official radiometric thermal data or
  validated DJI thermal metadata.
- Calculate minimum, maximum, average, hot spot, cold spot, and coordinates in
  image space.
- Link thermal results to map markers when GPS metadata exists.
- Add UI for thermal image inspection, temperature scale, threshold alerts, and
  incident report snapshots.
- TODO(DJI Thermal): validate supported file formats, SDK/tooling, emissivity
  settings, reflected temperature assumptions, distance, humidity, and accuracy
  limits against official DJI documentation and real M30T/M4T captures.

Important boundary:

- A colorized thermal JPG/PNG without radiometric data can support visual
  hotspot detection only; it must not be treated as a reliable temperature
  source.

## Phase 7

Occurrences:

- Select and synchronize occurrences through the external occurrence SaaS API;
  do not invent or duplicate the external source contract.
- Associate drone, controller, pilot, stream, telemetry, photos, videos, thermal
  analysis and timeline.
