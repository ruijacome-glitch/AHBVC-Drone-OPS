ALTER TABLE stream_share_links
  ADD COLUMN IF NOT EXISTS target_type text NOT NULL DEFAULT 'stream',
  ADD COLUMN IF NOT EXISTS target_config jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS stream_share_links_target_idx
  ON stream_share_links (organisation_id, target_type, created_at DESC);
