# SaaS Foundation

## Product Decision

AirSector is a multi-tenant operational SaaS for emergency services. AHBVC
is the first organisation, pilot customer and validation environment. Its brand
and local integrations are tenant configuration, not product defaults embedded
in application logic.

## Tenant Configuration

Each organisation can independently configure:

- identity, logo, colors and custom domain
- locale, timezone and map defaults
- users, memberships and role policy
- DJI Cloud API workspace and credentials
- occurrence-system integration
- SMTP and SMS providers
- storage and data-retention policy
- report templates and numbering
- enabled features and operational limits

Secrets remain encrypted server-side and are never returned to management
interfaces after creation.

## Isolation Rules

- Every tenant-owned database row has `organisation_id`.
- API identity determines tenant scope; request bodies cannot override it.
- Repository methods require tenant context and never provide unscoped list or
  lookup operations to tenant-facing services.
- MinIO paths, Redis keys, jobs, MQTT gateway mappings and WebSocket channels
  are tenant-scoped.
- Foreign-key and uniqueness constraints include tenant ownership where needed.
- Audit events record organisation, actor, action, target and outcome.
- Tests prove that a user from organisation A cannot discover, read, modify,
  stream, export or delete resources from organisation B.

## Commercial Controls

Plans grant entitlements rather than scattering plan-name checks through the
code. Initial measurable dimensions should include:

- active users and pilots
- registered and simultaneously connected drones
- retained telemetry and storage
- live-stream minutes and external viewers
- generated reports
- email and SMS deliveries
- future thermal and AI processing

Operational data collection must not stop abruptly because of a commercial
limit during an emergency. Prefer alerts, grace periods and post-operation
enforcement for safety-critical limits.

## Platform Administration

Create a platform administration boundary separate from tenant administration:

- organisation lifecycle and plan assignment
- aggregate service health and usage, with minimal operational-data exposure
- support access requiring reason, expiry and audit
- integration health and delivery diagnostics
- backup, restore, export and offboarding workflow

## Readiness Gate For A Second Customer

Before onboarding another organisation:

1. Complete the tenant-isolation audit and automated negative tests.
2. Remove remaining AHBVC-specific constants from product code.
3. Validate per-tenant secrets and DJI gateway ownership.
4. Validate storage, stream, WebSocket and background-job isolation.
5. Document backup, restore, incident response and data deletion.
6. Separate production, staging and demonstration data.
7. Publish contractual service limits, support scope and retention behavior.
