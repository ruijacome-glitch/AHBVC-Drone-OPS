ALTER TABLE occurrences
  ADD COLUMN IF NOT EXISTS external_source text,
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS external_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS occurrences_external_reference_idx
  ON occurrences (organisation_id, external_source, external_id)
  WHERE external_source IS NOT NULL AND external_id IS NOT NULL;

ALTER TABLE missions
  ADD COLUMN IF NOT EXISTS organisation_id uuid REFERENCES organisations(id),
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS objective text,
  ADD COLUMN IF NOT EXISTS operational_area text,
  ADD COLUMN IF NOT EXISTS is_training boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE missions m
SET organisation_id = COALESCE(
  (SELECT organisation_id FROM occurrences WHERE id = m.occurrence_id),
  (SELECT organisation_id FROM drones WHERE id = m.drone_id),
  (SELECT organisation_id FROM controllers WHERE id = m.controller_id),
  (SELECT organisation_id FROM users WHERE id = m.pilot_id)
)
WHERE m.organisation_id IS NULL;

ALTER TABLE missions ALTER COLUMN status SET DEFAULT 'draft';
CREATE INDEX IF NOT EXISTS missions_organisation_status_idx
  ON missions (organisation_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS flights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  mission_id uuid NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  sequence_number integer NOT NULL CHECK (sequence_number > 0),
  drone_id uuid REFERENCES drones(id),
  controller_id uuid REFERENCES controllers(id),
  pilot_id uuid REFERENCES users(id),
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'active', 'completed', 'aborted')),
  notes text,
  started_at timestamptz,
  ended_at timestamptz,
  takeoff_location geography(Point, 4326),
  landing_location geography(Point, 4326),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mission_id, sequence_number)
);

CREATE INDEX IF NOT EXISTS flights_mission_time_idx
  ON flights (mission_id, sequence_number);
CREATE UNIQUE INDEX IF NOT EXISTS flights_one_active_drone_idx
  ON flights (drone_id) WHERE status = 'active' AND drone_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS flights_one_active_controller_idx
  ON flights (controller_id) WHERE status = 'active' AND controller_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS mission_events (
  id bigserial PRIMARY KEY,
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  mission_id uuid NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  from_status text,
  to_status text,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mission_events_timeline_idx
  ON mission_events (mission_id, created_at DESC);

ALTER TABLE flight_tracks
  ADD COLUMN IF NOT EXISTS flight_id uuid REFERENCES flights(id) ON DELETE SET NULL;
ALTER TABLE telemetry_points
  ADD COLUMN IF NOT EXISTS flight_id uuid REFERENCES flights(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS telemetry_points_flight_time_idx
  ON telemetry_points (flight_id, observed_at DESC) WHERE flight_id IS NOT NULL;
