INSERT INTO organisations (name, slug)
VALUES ('Bombeiros Voluntarios de Cascais', 'ahbvc')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO roles (name, description)
VALUES
  ('Administrador', 'Full platform administration'),
  ('Operador', 'Operations command and incident management'),
  ('Piloto', 'Drone pilot access'),
  ('Observador', 'Read-only operational view')
ON CONFLICT (name) DO NOTHING;

