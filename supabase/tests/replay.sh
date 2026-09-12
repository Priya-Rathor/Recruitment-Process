#!/usr/bin/env bash
#
# Replay every migration against a throwaway Postgres, then run the SQL checks.
#
# WHY THIS EXISTS. docs/DEPLOYMENT.md listed "no CI check that migrations replay
# cleanly from empty" as a gap for months, and the first time anyone ran one it
# failed immediately: 0030_module15_candidate_messaging.sql was a 4-byte
# truncated file containing the word `writ`, so EVERY migration after it — live
# coding, privacy, forms, voice agents, workflows, custom fields — could never
# have been applied to a new database at all. A fresh workspace built from this
# repo was broken and nothing said so.
#
# Run it before any deploy that touches supabase/, and after adding a migration.
#
#   ./supabase/tests/replay.sh
#
# Requires Docker. Leaves nothing behind: the container is removed on exit,
# whether the run passed or failed.
set -euo pipefail

CONTAINER="recruitment-os-migration-replay"
IMAGE="postgres:16-alpine"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "==> starting $IMAGE"
cleanup
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=replay -e POSTGRES_DB=app "$IMAGE" >/dev/null

echo "==> waiting for postgres"
until docker exec "$CONTAINER" pg_isready -U postgres -d app >/dev/null 2>&1; do sleep 1; done

run() { docker exec "$CONTAINER" psql -U postgres -d app -v ON_ERROR_STOP=1 "$@"; }

echo "==> applying the Supabase shim"
docker cp "$ROOT/supabase/tests/supabase_shim.sql" "$CONTAINER:/tmp/shim.sql" >/dev/null
run -q -f /tmp/shim.sql >/dev/null

# Applied one file at a time, in filename order, so a failure names the migration
# rather than a line number in an 10,000-line bundle.
echo "==> replaying migrations"
for file in "$ROOT"/supabase/migrations/*.sql; do
  name="$(basename "$file")"
  docker cp "$file" "$CONTAINER:/tmp/m.sql" >/dev/null
  if ! run -q -f /tmp/m.sql >/tmp/replay-out 2>&1; then
    echo "    FAILED: $name"
    sed 's/^/      /' /tmp/replay-out | grep -iE "error|fatal" | head -5
    exit 1
  fi
  echo "    ok  $name"
done

# Every VERIFY_*.sql in supabase/ is a behavioural check that raises on failure.
echo "==> running verification scripts"
shopt -s nullglob
for file in "$ROOT"/supabase/VERIFY_*.sql; do
  name="$(basename "$file")"
  echo "    $name"
  docker cp "$file" "$CONTAINER:/tmp/v.sql" >/dev/null
  docker exec "$CONTAINER" psql -U postgres -d app -v ON_ERROR_STOP=1 -f /tmp/v.sql 2>&1 \
    | grep -E "NOTICE|ERROR" | sed 's/^.*NOTICE:  /      /; s/^.*ERROR:  /      ERROR: /'
done

echo "==> all migrations replay cleanly and every check passed"
