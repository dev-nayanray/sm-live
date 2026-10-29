#!/usr/bin/env bash
# Restore: ./infra/restore.sh backups/sm_live_YYYYMMDD_HHMMSS.sql.gz
set -euo pipefail
cd "$(dirname "$0")"
FILE="${1:?usage: restore.sh <dump.sql.gz>}"
[[ -f "$FILE" ]] || { echo "no such dump: $FILE"; exit 1; }
echo "stopping api + provider-mock…"
docker compose -f docker-compose.yml stop api provider-mock >/dev/null 2>&1 || true
gunzip -c "$FILE" | docker compose -f docker-compose.yml exec -T postgres psql -U sm_live -d sm_live
echo "restore done — restarting…"
docker compose -f docker-compose.yml start api provider-mock
echo "verify: curl -s localhost:4001/health && /v1/admin/wallet/integrity"
