#!/usr/bin/env bash
# Dumps the ForgeFlow database into /opt/forgeflow/backups (pg_dump custom format, for pg_restore)
# and deletes dumps older than KEEP_DAYS (14). Cron runs it daily (bootstrap.sh). The dumps sit on
# the same disk as the database: copy them elsewhere too.
set -euo pipefail

root=${FORGEFLOW_ROOT:-/opt/forgeflow}
scripts=$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")
file=$root/backups/forgeflow-$(date -u +%Y%m%dT%H%M%SZ).dump

bash "$scripts/compose.sh" exec -T postgres pg_dump -U forgeflow -d forgeflow --format=custom > "$file.partial"
mv "$file.partial" "$file"
find "$root/backups" -name 'forgeflow-*.dump' -mtime "+${KEEP_DAYS:-14}" -delete
echo "$(date -u +%FT%TZ) $file $(du -h "$file" | cut -f1)"
