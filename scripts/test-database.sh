#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required. See docs/TESTING.md." >&2
  exit 1
fi

if command -v psql >/dev/null 2>&1; then
  psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f supabase/tests/game_flow.sql
  exit 0
fi

if command -v docker >/dev/null 2>&1; then
  docker_url="${DATABASE_URL/127.0.0.1/host.docker.internal}"
  docker_url="${docker_url/localhost/host.docker.internal}"
  docker run --rm \
    --add-host host.docker.internal:host-gateway \
    --volume "$PWD:/workspace:ro" \
    postgres:15-alpine \
    psql "$docker_url" -X -v ON_ERROR_STOP=1 -f /workspace/supabase/tests/game_flow.sql
  exit 0
fi

echo "Install PostgreSQL's psql client or Docker, then try again." >&2
exit 1
