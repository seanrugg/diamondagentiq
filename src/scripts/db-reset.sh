#!/usr/bin/env bash
set -euo pipefail

echo "WARNING: db:reset destroys the diq-postgres named volume. All DiamondAgentIQ Postgres data will be lost."

docker compose down --volumes --remove-orphans
exec bash src/scripts/db-up.sh
