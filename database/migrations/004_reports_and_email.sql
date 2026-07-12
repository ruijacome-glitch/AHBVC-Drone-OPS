CREATE TABLE IF NOT EXISTS report_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid REFERENCES organisations(id) ON DELETE SET NULL,
  mission_id uuid REFERENCES missions(id) ON DELETE SET NULL,
  occurrence_id uuid REFERENCES occurrences(id) ON DELETE SET NULL,
  report_type text NOT NULL,
  title text NOT NULL,
  storage_bucket text NOT NULL,
  storage_key text NOT NULL UNIQUE,
  content_type text NOT NULL DEFAULT 'application/pdf',
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  sha256 char(64) NOT NULL,
  generated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  generated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS report_documents_mission_idx
  ON report_documents (mission_id, generated_at DESC);

CREATE TABLE IF NOT EXISTS email_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid REFERENCES organisations(id) ON DELETE SET NULL,
  report_document_id uuid REFERENCES report_documents(id) ON DELETE SET NULL,
  sent_by uuid REFERENCES users(id) ON DELETE SET NULL,
  recipients text[] NOT NULL,
  subject text NOT NULL,
  status text NOT NULL CHECK (status IN ('sent', 'failed')),
  error_message text,
  sent_at timestamptz NOT NULL DEFAULT now()
);
