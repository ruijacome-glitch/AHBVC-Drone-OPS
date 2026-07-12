# External Stream Sharing

## Goal

Allow an authorized operator to share one temporary, read-only page containing
all active drone streams for a mission or occurrence. The same invitation can
be opened from a QR code, email or SMS.

## Operator Flow

1. Open the mission or occurrence and select `Share streams`.
2. Confirm all active streams or choose specific streams.
3. Set an expiration time and create the invitation.
4. Present the QR code, send an email, send an SMS, or copy the link.
5. Review delivery and access state, extend validity if policy allows, or revoke
   the invitation immediately.

## Viewer Flow

1. Open the invitation without a platform account.
2. Exchange the opaque token for a short-lived viewer session.
3. See the occurrence reference and the currently authorized drone streams.
4. Watch through WebRTC, with HLS fallback when necessary.
5. See an explicit ended, offline, expired or revoked state instead of a raw
   MediaMTX error.

## Security Requirements

- Generate at least 256 bits of cryptographically secure token entropy.
- Store only a keyed or one-way hash of the invitation token.
- Put the raw token in the URL fragment, exchange it once, and clear it.
- Use Secure, HttpOnly and appropriately scoped viewer cookies.
- Default to short validity and require an explicit expiration.
- Support immediate revocation and invalidate active viewer sessions.
- Do not expose publication URLs, stream keys, DJI tokens or MQTT credentials.
- Keep the viewer read-only and scoped to one occurrence or mission.
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
