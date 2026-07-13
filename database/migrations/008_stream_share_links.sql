CREATE TABLE IF NOT EXISTS stream_share_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  token_hash char(64) NOT NULL UNIQUE,
  label text NOT NULL,
  gateway_sn text NOT NULL,
  video_id text,
  permissions jsonb NOT NULL DEFAULT '["video"]'::jsonb,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_accessed_at timestamptz
);

CREATE INDEX IF NOT EXISTS stream_share_links_active_idx
  ON stream_share_links (organisation_id, expires_at DESC)
  WHERE revoked_at IS NULL;
