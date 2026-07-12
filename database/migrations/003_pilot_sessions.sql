CREATE TABLE IF NOT EXISTS pilot_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  organisation_id uuid REFERENCES organisations(id) ON DELETE SET NULL,
  controller_sn text NOT NULL,
  aircraft_sn text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  connected_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  disconnected_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS pilot_sessions_one_active_controller_idx
  ON pilot_sessions (controller_sn)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS pilot_sessions_user_started_idx
  ON pilot_sessions (user_id, connected_at DESC);
