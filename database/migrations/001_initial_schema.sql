CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE organisations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid REFERENCES organisations(id),
  email text NOT NULL UNIQUE,
  full_name text NOT NULL,
  password_hash text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_roles (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE controllers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid REFERENCES organisations(id),
  gateway_sn text NOT NULL UNIQUE,
  callsign text,
  model text,
  online_status text NOT NULL DEFAULT 'offline',
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE drones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid REFERENCES organisations(id),
  controller_id uuid REFERENCES controllers(id),
  serial_number text NOT NULL UNIQUE,
  model text NOT NULL,
  online_status text NOT NULL DEFAULT 'offline',
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payloads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drone_id uuid REFERENCES drones(id) ON DELETE CASCADE,
  serial_number text,
  model text NOT NULL,
  payload_type text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid REFERENCES organisations(id),
  code text NOT NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  location geography(Point, 4326),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE missions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurrence_id uuid REFERENCES occurrences(id),
  drone_id uuid REFERENCES drones(id),
  controller_id uuid REFERENCES controllers(id),
  pilot_id uuid REFERENCES users(id),
  status text NOT NULL DEFAULT 'planned',
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE flight_tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id uuid REFERENCES missions(id) ON DELETE CASCADE,
  drone_id uuid REFERENCES drones(id),
  track geometry(LineStringZ, 4326),
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE telemetry_points (
  id bigserial PRIMARY KEY,
  mission_id uuid REFERENCES missions(id),
  drone_id uuid REFERENCES drones(id),
  controller_id uuid REFERENCES controllers(id),
  drone_serial text NOT NULL,
  gateway_serial text NOT NULL,
  model text,
  position geography(Point, 4326),
  altitude_m numeric,
  speed_mps numeric,
  heading_deg numeric,
  pitch_deg numeric,
  roll_deg numeric,
  yaw_deg numeric,
  battery_percent numeric,
  gps_status text,
  rtk_status text,
  active_payload text,
  flight_mode text,
  link_quality text,
  source_topic text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  observed_at timestamptz NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX telemetry_points_position_idx ON telemetry_points USING gist (position);
CREATE INDEX telemetry_points_drone_time_idx ON telemetry_points (drone_serial, observed_at DESC);

CREATE TABLE livestreams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id uuid REFERENCES missions(id),
  drone_id uuid REFERENCES drones(id),
  stream_key text NOT NULL UNIQUE,
  rtmp_url text,
  webrtc_url text,
  hls_url text,
  status text NOT NULL DEFAULT 'offline',
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE media_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id uuid REFERENCES missions(id),
  occurrence_id uuid REFERENCES occurrences(id),
  drone_id uuid REFERENCES drones(id),
  storage_bucket text NOT NULL,
  storage_key text NOT NULL,
  media_type text NOT NULL,
  content_hash text,
  captured_at timestamptz,
  location geography(Point, 4326),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (storage_bucket, storage_key)
);

CREATE TABLE map_markers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurrence_id uuid REFERENCES occurrences(id),
  mission_id uuid REFERENCES missions(id),
  media_file_id uuid REFERENCES media_files(id),
  marker_type text NOT NULL,
  label text,
  location geography(Point, 4326) NOT NULL,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id bigserial PRIMARY KEY,
  actor_user_id uuid REFERENCES users(id),
  organisation_id uuid REFERENCES organisations(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  ip_address inet,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

