# External Stream Sharing

## Goal

Allow an authorized operator to share one temporary, read-only page containing
all active drone streams for a mission or occurrence. The same invitation can
be opened from a QR code, email or SMS.

## Operator Flow

1. Open the mission or occurrence and select `Share`.
2. Choose a permission preset and adjust the individual capabilities.
3. Confirm all active drones or choose specific drones and streams.
4. Set an expiration time and create the invitation.
5. Present the QR code, send an email, send an SMS, or copy the link.
6. Review delivery and access state, extend validity if policy allows, or revoke
   the invitation immediately.

## Viewer Flow

1. Open the invitation without a platform account.
2. Exchange the opaque token for a short-lived viewer session.
3. See only the modules and information authorized for that invitation.
4. Watch authorized video through WebRTC, with HLS fallback when necessary.
5. See an explicit ended, offline, expired or revoked state instead of a raw
   MediaMTX error.

## Invitation Capabilities

Every invitation has an explicit capability set. The backend enforces these
permissions on every API, WebSocket and playback request; hiding a control in
the viewer interface is not an authorization mechanism.

- `view_live_streams`: open the authorized live video streams.
- `view_multistream`: display more than one authorized stream simultaneously.
- `view_live_map`: display current positions of authorized drones.
- `view_drone_status`: display online state, battery, altitude, speed and
  heading. Precise technical telemetry remains internal unless selected.
- `view_live_tracks`: display the route accumulated during the active flight.
- `view_operational_markers`: display manually created operational map points.
- `view_media_markers`: display markers for georeferenced photos and videos.
- `view_media_previews`: open reduced-resolution media previews from a marker.
- `download_media`: download original media. Disabled by default.
- `view_thermal_overlays`: display approved thermal previews and derived
  measurements. Disabled by default and never a substitute for validated
  radiometric analysis.
- `view_occurrence_summary`: display a limited occurrence reference, type and
  status. Personal, clinical and other sensitive occurrence fields are never
  included by default.
- `view_timeline`: display selected operational timeline events.
- `view_historical_track`: display completed flight tracks. Disabled by
  default for links intended only for live monitoring.

The invitation must also contain scope restrictions:

- occurrence and/or mission identifier
- all current drones or an explicit drone allowlist
- all current streams or an explicit camera/stream allowlist
- validity start and expiration
- optional maximum concurrent viewer sessions
- optional geographic precision policy for map coordinates

Future capabilities can be added without changing existing invitations. An
unknown capability must always be denied.

## Permission Presets

Presets reduce setup time but are stored as the resulting explicit capability
set so later preset changes do not silently expand an existing invitation.

- `Video only`: live streams and multistream; no map or occurrence data.
- `Video and live map`: video, live drone positions and basic drone status.
- `Operational view`: video, live map, tracks, operational markers, media
  markers and media previews; no original downloads.
- `Custom`: operator selects each capability individually.

The creation screen must summarize exactly what the external viewer can access
before the link is generated.

## Security Requirements

- Generate at least 256 bits of cryptographically secure token entropy.
- Store only a keyed or one-way hash of the invitation token.
- Put the raw token in the URL fragment, exchange it once, and clear it.
- Use Secure, HttpOnly and appropriately scoped viewer cookies.
- Default to short validity and require an explicit expiration.
- Support immediate revocation and invalidate active viewer sessions.
- Do not expose publication URLs, stream keys, DJI tokens or MQTT credentials.
- Keep the viewer read-only and scoped to one occurrence or mission.
- Apply least privilege: every capability is denied unless explicitly enabled.
- Authorize API, WebSocket and MediaMTX playback server-side from the same
  invitation capability set.
- Recheck scope when drones, streams or media are added to a live mission.
- Rate-limit token exchanges and authorization failures.
- Record audit events without logging raw tokens or full phone numbers.
- Set `Referrer-Policy: no-referrer` and prevent indexing of the viewer page.

## Delivery Channels

### QR Code

Generate the QR code in the platform from the invitation URL. No external QR
service is required and the token is not sent to a third party.

### Email

Use the existing SMTP service and branded transactional templates. Store the
delivery outcome and a masked destination in `share_deliveries`.

### SMS

Expose a provider-neutral application interface such as `SmsSender`, with a
Preventech implementation behind it. The adapter requires the official
Preventech API contract before implementation:

- base URL and environment separation
- authentication mechanism
- send-message endpoint
- sender/originator rules
- request and response examples
- delivery receipt webhook and signature validation
- error codes, idempotency and rate limits
- sandbox credentials

Do not infer endpoint names or payload fields.

## Initial Authorization Policy

- Administrator: create, deliver, inspect and revoke invitations.
- Operator: create, deliver, inspect and revoke invitations for accessible
  occurrences and missions.
- Pilot: view internal streams; no external invitation creation initially.
- Observer: view streams allowed by RBAC; no invitation creation.

The policy can be adjusted after operational testing without changing the
invitation or delivery data model.
