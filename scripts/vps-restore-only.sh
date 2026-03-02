#!/bin/bash
# Krok 2 fresh install - seed + restore dominikql (uruchom gdy kontenery juz dzialaja)
set -e
cd /opt/contentvault
source .env
BACKUP_DIR="/tmp/contentvault_fresh_install_backup"
PROTECTED_EMAIL="dominikql.smurf@gmail.com"

echo "Seed..."
docker compose run --rm -e "DATABASE_URL=postgresql://platform:${POSTGRES_PASSWORD}@postgres:5432/content_platform" frontend npx tsx prisma/seed.ts 2>/dev/null || true

echo "Restore $PROTECTED_EMAIL..."
docker cp "$BACKUP_DIR/pre_nuke.dump" $(docker compose ps -q postgres):/tmp/restore.dump
docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres sh -c "createdb -U platform backup_restore 2>/dev/null || true; pg_restore -U platform -d backup_restore --no-owner --no-acl /tmp/restore.dump 2>/dev/null || true"

pc() { docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres psql -U platform "$@"; }

pc -d backup_restore -t -A -c "COPY (SELECT id,email,password,name,discord_id,role,avatar_url,credit_balance,last_login_at,created_at,updated_at FROM users WHERE email='$PROTECTED_EMAIL') TO STDOUT WITH CSV" > "$BACKUP_DIR/user.csv" 2>/dev/null

if [[ -s "$BACKUP_DIR/user.csv" ]]; then
  docker compose exec -i -e PGPASSWORD="$POSTGRES_PASSWORD" postgres psql -U platform -d content_platform -c "COPY users(id,email,password,name,discord_id,role,avatar_url,credit_balance,last_login_at,created_at,updated_at) FROM STDIN WITH CSV" < "$BACKUP_DIR/user.csv"
  echo "OK User"
fi

pc -d backup_restore -t -A -c "COPY (SELECT a.id,a.user_id,a.type,a.provider,a.provider_account_id,a.refresh_token,a.access_token,a.expires_at,a.token_type,a.scope,a.id_token,a.session_state FROM accounts a JOIN users u ON u.id=a.user_id AND u.email='$PROTECTED_EMAIL') TO STDOUT WITH CSV" > "$BACKUP_DIR/accounts.csv" 2>/dev/null
if [[ -s "$BACKUP_DIR/accounts.csv" ]]; then
  docker compose exec -i -e PGPASSWORD="$POSTGRES_PASSWORD" postgres psql -U platform -d content_platform -c "COPY accounts(id,user_id,type,provider,provider_account_id,refresh_token,access_token,expires_at,token_type,scope,id_token,session_state) FROM STDIN WITH CSV" < "$BACKUP_DIR/accounts.csv"
  echo "OK Accounts"
fi

pc -d postgres -c "DROP DATABASE IF EXISTS backup_restore;" 2>/dev/null
docker compose exec -T postgres rm -f /tmp/restore.dump 2>/dev/null
echo "Done."
