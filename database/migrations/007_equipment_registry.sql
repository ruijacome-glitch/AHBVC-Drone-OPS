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

-- The initial MQTT registration predated tenant ownership. In the current
-- single-organisation deployment, attach those legacy records to the
-- organisation already present in the database.
UPDATE controllers
SET organisation_id = (SELECT id FROM organisations ORDER BY created_at LIMIT 1)
WHERE organisation_id IS NULL;

UPDATE drones d
SET organisation_id = COALESCE(c.organisation_id,
                               (SELECT id FROM organisations ORDER BY created_at LIMIT 1))
FROM controllers c
WHERE d.controller_id = c.id AND d.organisation_id IS NULL;

UPDATE drones
SET organisation_id = (SELECT id FROM organisations ORDER BY created_at LIMIT 1)
WHERE organisation_id IS NULL;

CREATE INDEX IF NOT EXISTS controllers_organisation_idx
  ON controllers (organisation_id, callsign);
CREATE INDEX IF NOT EXISTS drones_organisation_idx
  ON drones (organisation_id, callsign);
CREATE INDEX IF NOT EXISTS payloads_drone_idx
  ON payloads (drone_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS payloads_serial_number_idx
  ON payloads (serial_number) WHERE serial_number IS NOT NULL;
