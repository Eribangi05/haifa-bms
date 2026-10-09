#!/usr/bin/env bash
# Proves a backup can actually be restored: dumps DATABASE_URL, restores into a scratch database, compares row counts of every table, drops the scratch DB.
# Usage: DATABASE_URL=postgres://rm:rm@localhost:5432/rwanda_mobility scripts/restore-test.sh      (needs pg_dump, psql, createdb rights)
set -euo pipefail
SRC="${DATABASE_URL:?set DATABASE_URL}"
SCRATCH="restore_check_$$"
BASE="${SRC%/*}"
DUMP="$(mktemp)"; trap 'rm -f "$DUMP"; psql "$BASE/postgres" -qc "drop database if exists $SCRATCH" >/dev/null 2>&1 || true' EXIT
pg_dump --no-owner --format=custom --file="$DUMP" "$SRC"
psql "$BASE/postgres" -qc "create database $SCRATCH"
pg_restore --no-owner --dbname="$BASE/$SCRATCH" "$DUMP"
counts() { psql "$1" -Atc "select format('%s=%s', relname, (xpath('/row/c/text()', query_to_xml(format('select count(*) c from %I', relname), false, true, '')))[1]::text) from pg_class where relkind='r' and relnamespace='public'::regnamespace order by 1"; }
A="$(counts "$SRC")"; B="$(counts "$BASE/$SCRATCH")"
if [ "$A" = "$B" ]; then echo "RESTORE OK: $(echo "$A" | wc -l) tables, identical row counts ($(echo "$A" | awk -F= '{s+=$2} END {print s}') rows in total)"; else echo "RESTORE MISMATCH"; diff <(echo "$A") <(echo "$B") || true; exit 1; fi
