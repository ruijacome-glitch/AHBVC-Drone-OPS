#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

docker compose exec -T postgres sh -c \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /docker-entrypoint-initdb.d/008_stream_share_links.sql -f /docker-entrypoint-initdb.d/009_stream_share_targets.sql -f /docker-entrypoint-initdb.d/010_permanent_stream_shares.sql'

echo "Stream share links, targets and permanent-link migration applied."
