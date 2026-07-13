# AirSector Brand Transition

## Decision

The product-facing name is **AirSector**. The initial positioning line is
**Aerial intelligence for critical operations.** AHBVC remains the first tenant,
operational validation partner and organisation identity shown alongside the
product where appropriate.

## Current Domain

Production continues to use the existing `uas.ahbvc.org.pt` domain and its API,
MQTT, stream, storage and Pilot 2 subdomains. A future domain migration must be
planned independently, with parallel DNS, certificates, CORS, cookies, OAuth or
JWT configuration, DJI Pilot 2 validation and rollback support.

## Stable Technical Identifiers

The brand transition does not rename the following operational identifiers:

- Git repository and local deployment directory
- Docker Compose project and service names
- PostgreSQL database and role
- MinIO buckets and existing object keys
- JWT issuer, audience and cookie names
- MQTT client IDs, topics and credentials
- existing URLs or Traefik routes

Keeping these identifiers stable avoids unnecessary downtime and data migration.

## Brand Architecture

AirSector follows a branded-house model. Product capabilities use descriptive
names such as AirSector Command, AirSector Live, AirSector Map, AirSector
Thermal, AirSector Evidence, AirSector Connect and AirSector AI. These are
capability labels, not separate products or independent brands.

Tenant identity is configurable. In the AHBVC deployment, the AHBVC crest and
organisation name identify the operator while AirSector identifies the product.

## Before A Domain Change

1. Complete formal trademark clearance for AirSector in target markets.
2. Acquire the selected primary and defensive domains.
3. Add runtime tenant branding so product and organisation identity are not
   compiled into the frontend bundle.
4. Run old and new domains in parallel and validate DJI Pilot 2 on hardware.
5. Migrate cookies, CORS, links, email templates and public shares deliberately.
6. Keep redirects and rollback available for an agreed transition period.
