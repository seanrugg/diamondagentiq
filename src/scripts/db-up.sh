#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DIQ_PG_PASSWORD:-}" ]] && [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

if [[ -z "${DIQ_PG_PASSWORD:-}" ]]; then
  echo "DIQ_PG_PASSWORD is not set. Copy .env.example to .env first." >&2
  exit 1
fi

docker compose up -d diq-postgres

for _ in $(seq 1 60); do
  status="$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}starting{{end}}' diq-postgres 2>/dev/null || echo starting)"
  if [[ "${status}" == "healthy" ]]; then
    echo "diq-postgres is healthy"
    exit 0
  fi
  sleep 1
done

echo "diq-postgres did not become healthy in time" >&2
exit 1
