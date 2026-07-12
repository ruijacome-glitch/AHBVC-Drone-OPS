CREATE TABLE IF NOT EXISTS refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  replaced_by_token_id uuid REFERENCES refresh_tokens(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  ip_address inet,
  user_agent text
);

CREATE INDEX IF NOT EXISTS refresh_tokens_user_active_idx
  ON refresh_tokens (user_id, expires_at DESC)
  WHERE revoked_at IS NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

INSERT INTO roles (name, description)
VALUES
  ('Administrador', 'Full platform administration'),
  ('Operador', 'Operations command and incident management'),
  ('Piloto', 'Drone pilot access'),
  ('Observador', 'Read-only operational view')
ON CONFLICT (name) DO NOTHING;
