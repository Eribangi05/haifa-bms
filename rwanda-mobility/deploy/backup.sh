#!/usr/bin/env bash
# Nightly backup for the docker compose stack: a PostgreSQL dump plus the uploaded-documents volume.
# Run from the rwanda-mobility/ folder (cron example: 30 1 * * * cd /srv/rwanda-mobility && deploy/backup.sh /srv/backups).
# Copy the output OFF this host (object storage, another server) and test a restore with docs/OPERATIONS_RUNBOOK.md. Keep DATA_ENC_KEY backed up separately.
set -euo pipefail
OUT="${1:-./backups}"; STAMP="$(date -u +%Y%m%dT%H%M%SZ)"; DC="docker compose -f deploy/docker-compose.yml --env-file deploy/.env"
mkdir -p "$OUT"
$DC exec -T db pg_dump -U rm -d rwanda_mobility --format=custom --no-owner > "$OUT/db-$STAMP.dump"
$DC exec -T api tar -C /data -czf - storage > "$OUT/storage-$STAMP.tgz"
# keep 14 days locally
find "$OUT" -name 'db-*.dump' -mtime +14 -delete; find "$OUT" -name 'storage-*.tgz' -mtime +14 -delete
echo "backup written: $OUT/db-$STAMP.dump $OUT/storage-$STAMP.tgz"
