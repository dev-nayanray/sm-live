#!/usr/bin/env bash
# Postgres backup: ./infra/backup.sh [--install] (install = daily 02:00 cron)
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p backups
STAMP=$(date -u +%Y%m%d_%H%M%S)
FILE="backups/sm_live_${STAMP}.sql.gz"
docker compose -f docker-compose.yml exec -T postgres pg_dump -U sm_live sm_live | gzip > "$FILE"
echo "wrote $FILE ($(du -h "$FILE" | cut -f1))"
# keep 14 days
ls -1t backups/sm_live_*.sql.gz 2>/dev/null | tail -n +15 | xargs -r rm --
if [[ "${1:-}" == "--install" ]]; then
  CRON="0 2 * * * cd $(pwd) && ./backup.sh >> backups/backup.log 2>&1"
  (crontab -l 2>/dev/null | grep -v backup.sh; echo "$CRON") | crontab -
  echo "cron installed (daily 02:00)"
fi
