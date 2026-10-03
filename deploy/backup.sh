#!/bin/sh
# Runs inside the backup container: dump now, then every $BACKUP_EVERY_SECONDS,
# deleting dumps older than $BACKUP_KEEP_DAYS days.
set -eu

while true; do
  file="/backups/kubelearn-$(date -u +%Y-%m-%dT%H%MZ).dump"
  # write to a temporary name first: a half-written dump never looks like a good one
  if pg_dump --format=custom --compress=9 --file="$file.partial"; then
    mv "$file.partial" "$file"
    echo "backup: wrote $file ($(du -h "$file" | cut -f1))"
  else
    rm -f "$file.partial"
    echo "backup: FAILED at $(date -u)" >&2
  fi
  find /backups -name 'kubelearn-*.dump' -mmin "+$((BACKUP_KEEP_DAYS * 1440))" -print -delete | sed 's/^/backup: pruned /'
  sleep "$BACKUP_EVERY_SECONDS"
done
