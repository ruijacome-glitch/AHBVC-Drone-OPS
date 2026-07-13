ALTER TABLE controllers
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS notes text;

ALTER TABLE drones
  ADD COLUMN IF NOT EXISTS callsign text,
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS notes text;

ALTER TABLE payloads
  ADD COLUMN IF NOT EXISTS callsign text,
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'available',
  ADD COLUMN IF NOT EXISTS notes text;

CREATE INDEX IF NOT EXISTS controllers_organisation_idx
  ON controllers (organisation_id, callsign);
CREATE INDEX IF NOT EXISTS drones_organisation_idx
  ON drones (organisation_id, callsign);
CREATE INDEX IF NOT EXISTS payloads_drone_idx
  ON payloads (drone_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS payloads_serial_number_idx
  ON payloads (serial_number) WHERE serial_number IS NOT NULL;
