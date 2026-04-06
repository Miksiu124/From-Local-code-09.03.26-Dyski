#!/bin/sh
set -eu

if [ "${R2_DB_BACKUP_SYNC_ENABLED:-0}" != "1" ]; then
  echo "[postgres-backup-r2] Disabled — set R2_DB_BACKUP_SYNC_ENABLED=1 in .env to upload backups to R2."
  exec tail -f /dev/null
fi

: "${R2_ENDPOINT:?R2_ENDPOINT is required when R2_DB_BACKUP_SYNC_ENABLED=1}"
: "${R2_ACCESS_KEY_ID:?R2_ACCESS_KEY_ID is required when R2_DB_BACKUP_SYNC_ENABLED=1}"
: "${R2_SECRET_ACCESS_KEY:?R2_SECRET_ACCESS_KEY is required when R2_DB_BACKUP_SYNC_ENABLED=1}"

# Osobny bucket tylko pod backupy (jeśli pusty → ten sam co aplikacja: R2_BUCKET_NAME)
BUCKET_NAME="${R2_DB_BACKUP_BUCKET_NAME:-${R2_BUCKET_NAME:-}}"
: "${BUCKET_NAME:?Set R2_DB_BACKUP_BUCKET_NAME or R2_BUCKET_NAME when R2_DB_BACKUP_SYNC_ENABLED=1}"

PREFIX="${R2_DB_BACKUP_PREFIX:-db-backups}"
CRON_SCHEDULE="${R2_DB_BACKUP_SYNC_CRON:-45 3 * * *}"
DELETE_FLAG="${R2_BACKUP_SYNC_DELETE:-1}"
AWS_REGION="${AWS_DEFAULT_REGION:-auto}"

mkdir -p /root/.aws
aws configure set aws_access_key_id "$R2_ACCESS_KEY_ID"
aws configure set aws_secret_access_key "$R2_SECRET_ACCESS_KEY"
aws configure set default.region "$AWS_REGION"

printf '%s' "$R2_ENDPOINT" > /etc/r2-endpoint-url
printf '%s' "$BUCKET_NAME" > /etc/r2-backup-bucket
printf '%s' "$PREFIX" > /etc/r2-backup-prefix
printf '%s' "$DELETE_FLAG" > /etc/r2-backup-delete-flag

cat > /usr/local/bin/r2-db-backup-sync.sh <<'EOS'
#!/bin/sh
set -eu
BUCKET=$(cat /etc/r2-backup-bucket)
PREFIX=$(cat /etc/r2-backup-prefix)
ENDPOINT=$(cat /etc/r2-endpoint-url)
DEL=$(cat /etc/r2-backup-delete-flag)
echo "[postgres-backup-r2] sync start $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
if [ "$DEL" = "1" ]; then
  aws s3 sync /backups "s3://${BUCKET}/${PREFIX}/" --endpoint-url "$ENDPOINT" --only-show-errors --delete
else
  aws s3 sync /backups "s3://${BUCKET}/${PREFIX}/" --endpoint-url "$ENDPOINT" --only-show-errors
fi
echo "[postgres-backup-r2] sync done $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
EOS
chmod +x /usr/local/bin/r2-db-backup-sync.sh

echo "${CRON_SCHEDULE} /usr/local/bin/r2-db-backup-sync.sh" > /etc/crontabs/root

if [ "${R2_SYNC_ON_START:-0}" = "1" ]; then
  echo "[postgres-backup-r2] R2_SYNC_ON_START=1 — running sync once"
  /usr/local/bin/r2-db-backup-sync.sh || echo "[postgres-backup-r2] initial sync failed (empty volume is OK)"
fi

echo "[postgres-backup-r2] cron: ${CRON_SCHEDULE} (${TZ:-UTC}) → s3://${BUCKET_NAME}/${PREFIX}/"
exec /usr/local/bin/supercronic /etc/crontabs/root
