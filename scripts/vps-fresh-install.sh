#!/bin/bash
# ContentVault — Pełna fresh instalacja z repo (nukuje kod i bazę)
# ZACHOWUJE: .env (klucze), dane użytkownika dominikql.smurf@gmail.com
#
# Uruchom NA VPS: cd /opt/contentvault && bash scripts/vps-fresh-install.sh
# Albo zdalnie: ssh user@VPS_IP 'cd /opt/contentvault && bash scripts/vps-fresh-install.sh'
#
# Wymaga: git, docker compose
# Repo: https://github.com/Miksiu124/ContentManager.git

set -e

PROTECTED_EMAIL="${PROTECTED_EMAIL:-dominikql.smurf@gmail.com}"
REPO_URL="${REPO_URL:-https://github.com/Miksiu124/ContentManager.git}"
REPO_BRANCH="${REPO_BRANCH:-main}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_DIR="/tmp/contentvault_fresh_install_backup"
DUMP_FILE="$BACKUP_DIR/pre_nuke.dump"

cd "$REPO_ROOT"

echo "=========================================="
echo "ContentVault — FRESH INSTALL"
echo "=========================================="
echo "Chroniony użytkownik: $PROTECTED_EMAIL"
echo "Repo: $REPO_URL ($REPO_BRANCH)"
echo ""

# Załaduj .env
if [[ -f .env ]]; then
  set -a
  source .env
  set +a
else
  echo "Błąd: Brak pliku .env"
  exit 1
fi

# 1. Backup .env
echo "[1/9] Backup .env..."
mkdir -p "$BACKUP_DIR"
cp .env "$BACKUP_DIR/.env.backup"

# 2. Dump bazy przed nukowaniem
echo "[2/9] Dump bazy PostgreSQL..."
docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres pg_dump -U platform content_platform -Fc > "$DUMP_FILE"
echo "   Zapisano: $(du -h "$DUMP_FILE" | cut -f1)"

# 3. Zatrzymaj i usuń wszystko
echo "[3/9] Zatrzymuję kontenery i usuwam wolumeny..."
docker compose down -v

# 4. Pobierz świeży kod z repo
echo "[4/9] Pobieram świeży kod z repo..."
if [[ -d .git ]]; then
  git remote set-url origin "$REPO_URL" 2>/dev/null || true
  git fetch origin "$REPO_BRANCH" --force 2>/dev/null || git fetch origin --force
  git reset --hard "origin/$REPO_BRANCH"
  git clean -fdx -e ".env*" 2>/dev/null || true
else
  cd ..
  PARENT="$(pwd)"
  DIRNAME="$(basename "$REPO_ROOT")"
  rm -rf "$DIRNAME"
  git clone -b "$REPO_BRANCH" "$REPO_URL" "$DIRNAME"
  cd "$DIRNAME"
fi

# 5. Przywróć .env
echo "[5/9] Przywracam .env..."
cp "$BACKUP_DIR/.env.backup" .env

# 6. Build i start
echo "[6/9] Buduję i uruchamiam..."
docker compose build --no-cache
docker compose up -d

# 7. Czekaj na Postgres
echo "[7/9] Czekam na PostgreSQL..."
for i in $(seq 1 30); do
  if docker compose exec -T postgres pg_isready -U platform -d content_platform -q 2>/dev/null; then
    echo "   Gotowe"
    break
  fi
  [[ $i -eq 30 ]] && { echo "Timeout!"; exit 1; }
  sleep 1
done

# 8. Seed
echo "[8/9] Uruchamiam seed..."
(docker compose exec -T api ./server -seed 2>/dev/null) || \
(docker compose run --rm -e DATABASE_URL="postgresql://platform:${POSTGRES_PASSWORD}@postgres:5432/content_platform?sslmode=disable" frontend npx tsx prisma/seed.ts 2>/dev/null) || \
echo "   Uruchom recznie seed (prisma/seed.ts)"

# 9. Przywróć dane chronionego użytkownika
echo "[9/9] Przywracam dane $PROTECTED_EMAIL..."

# Wgraj dump do kontenera i przywróć do bazy tymczasowej
docker cp "$DUMP_FILE" $(docker compose ps -q postgres):/tmp/restore.dump

docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres sh -c "
  createdb -U platform backup_restore 2>/dev/null || true
  pg_restore -U platform -d backup_restore --no-owner --no-acl /tmp/restore.dump 2>/dev/null || true
"

# Eksport do plików na hoście, potem import (unikamy problemów z pipe)
pc() { docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres psql -U platform "$@"; }

# User — eksport do pliku (bez psql footera)
pc -d backup_restore -t -A -c "
  COPY (SELECT id,email,password,name,discord_id,role,avatar_url,credit_balance,last_login_at,created_at,updated_at
        FROM users WHERE email='$PROTECTED_EMAIL') TO STDOUT WITH CSV
" > "$BACKUP_DIR/user.csv" 2>/dev/null

if [[ -s "$BACKUP_DIR/user.csv" ]]; then
  docker compose exec -i -e PGPASSWORD="$POSTGRES_PASSWORD" postgres psql -U platform -d content_platform -c "
    COPY users(id,email,password,name,discord_id,role,avatar_url,credit_balance,last_login_at,created_at,updated_at)
    FROM STDIN WITH CSV
  " < "$BACKUP_DIR/user.csv" 2>/dev/null && echo "   ✓ User (hasło, kredyty)"
else
  echo "   (User $PROTECTED_EMAIL nie znaleziony w backupie)"
fi

# Accounts (OAuth)
pc -d backup_restore -t -A -c "
  COPY (SELECT a.id,a.user_id,a.type,a.provider,a.provider_account_id,a.refresh_token,a.access_token,a.expires_at,a.token_type,a.scope,a.id_token,a.session_state
        FROM accounts a JOIN users u ON u.id=a.user_id AND u.email='$PROTECTED_EMAIL') TO STDOUT WITH CSV
" > "$BACKUP_DIR/accounts.csv" 2>/dev/null

if [[ -s "$BACKUP_DIR/accounts.csv" ]]; then
  docker compose exec -i -e PGPASSWORD="$POSTGRES_PASSWORD" postgres psql -U platform -d content_platform -c "
    COPY accounts(id,user_id,type,provider,provider_account_id,refresh_token,access_token,expires_at,token_type,scope,id_token,session_state)
    FROM STDIN WITH CSV
  " < "$BACKUP_DIR/accounts.csv" 2>/dev/null && echo "   ✓ Accounts"
fi

# Cleanup
pc -d postgres -c "DROP DATABASE IF EXISTS backup_restore;" 2>/dev/null
docker compose exec -T postgres rm -f /tmp/restore.dump 2>/dev/null

echo ""
echo "=========================================="
echo "GOTOWE. Fresh instalacja zakończona."
echo "=========================================="
echo "Użytkownik $PROTECTED_EMAIL: hasło i kredyty zachowane."
echo "Uwaga: Dostępy do modeli (user_access) wymagają modeli w bazie."
echo "       Jeśli modele są synchronizowane z R2 — uruchom sync po odświeżeniu."
echo ""
echo "Sprawdź: docker compose ps"
echo "Usuń backup: rm -rf $BACKUP_DIR"
echo ""
