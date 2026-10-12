#!/usr/bin/env bash
# Starts an isolated server for end-to-end tests: fresh *_e2e database, seed data,
# a known admin account, and the built web app served from the API.
set -euo pipefail
cd "$(dirname "$0")/../../server"
export DATABASE_URL="${E2E_DATABASE_URL:-postgres://cat100:cat100@localhost:5432/cat100_e2e}"
export NODE_ENV=development RATE_LIMIT_DISABLED=true AI_PROVIDER=none PORT="${E2E_PORT:-4100}" WEB_DIST="../web/dist" LOG_LEVEL=warn
npx tsx src/db/reset.ts
SEED_ADMIN_EMAIL=admin@e2e.local SEED_ADMIN_PASSWORD='e2e admin password' npx tsx src/seed/run.ts
exec npx tsx src/index.ts
