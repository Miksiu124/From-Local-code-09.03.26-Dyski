#!/bin/bash
# ContentVault — pełna przebudowa od zera z zachowaniem wybranych użytkowników
# Używa ZSYNCHRONIZOWANEGO KODU (nie git fetch). Zachowuje .env.
#
# Uruchom NA VPS po deploy: cd /opt/contentvault && bash scripts/vps-rebuild-fresh.sh
# Albo zdalnie: .\scripts\deploy-vps.ps1 -RebuildFresh
#
# Zachowuje użytkowników: dominikql.smurf@gmail.com, puma3850@wp.pl, misi3k124@proton.me, hakpola@gmail.com

set -e

PROTECTED_EMAILS="dominikql.smurf@gmail.com|puma3850@wp.pl|misi3k124@proton.me|hakpola@gmail.com"
PROTECTED_EMAILS_SQL="'dominikql.smurf@gmail.com','puma3850@wp.pl','misi3k124@proton.me','hakpola@gmail.com'"

COMPOSE_FILES="-f docker-compose.yml"
if [[ "$1" == "--billionmail" ]]; then
  COMPOSE_FILES="-f docker-compose.yml -f docker-compose.billionmail.yml"
  echo "Używam BillionMail override."
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_DIR="/tmp/contentvault_rebuild_fresh_backup"
DUMP_FILE="$BACKUP_DIR/pre_rebuild.dump"

cd "$REPO_ROOT"

echo "=========================================="
echo "ContentVault — REBUILD OD ZERA (fresh DB)"
echo "=========================================="
echo "Zachowuję użytkowników: $PROTECTED_EMAILS"
echo ""

# Załaduj .env (strip CR for Windows-edited files)
if [[ -f .env ]]; then
  sed -i 's/\r$//' .env 2>/dev/null || true
  set -a
  source .env
  set +a
else
  echo "Błąd: Brak pliku .env"
  exit 1
fi

# 1. Backup .env
echo "[1/10] Backup .env..."
mkdir -p "$BACKUP_DIR"
cp .env "$BACKUP_DIR/.env.backup"

# 2. Dump bazy przed nukowaniem
echo "[2/10] Dump bazy PostgreSQL..."
if ! docker compose $COMPOSE_FILES exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres pg_dump -U platform content_platform -Fc > "$DUMP_FILE"; then
  echo "   (Baza niedostępna lub dump nieudany - kontynuuję bez przywracania użytkowników)"
  rm -f "$DUMP_FILE"
fi

# 3. Zatrzymaj i usuń wszystko (włącznie z postgres_data)
echo "[3/10] Zatrzymuję kontenery i usuwam wolumeny..."
docker compose $COMPOSE_FILES down -v

# 4. Przywróć .env (nie usuwamy - kopiujemy z backupu na wszelki wypadek)
echo "[4/10] Przywracam .env..."
cp "$BACKUP_DIR/.env.backup" .env

# 5. Przebuduj obrazy od zera
echo "[5/10] Buduję obrazy (--no-cache)..."
docker compose $COMPOSE_FILES build --no-cache

# 6. Uruchom
echo "[6/10] Uruchamiam kontenery..."
docker compose $COMPOSE_FILES up -d

# 7. Czekaj na Postgres
echo "[7/10] Czekam na PostgreSQL..."
for i in $(seq 1 60); do
  if docker compose $COMPOSE_FILES exec -T postgres pg_isready -U platform -d content_platform -q 2>/dev/null; then
    echo "   Gotowe"
    break
  fi
  [[ $i -eq 60 ]] && { echo "Timeout!"; exit 1; }
  sleep 1
done

# 8. Seed (kraje, ustawienia, admin, pakiety)
echo "[8/10] Uruchamiam seed..."
(docker compose $COMPOSE_FILES run --rm --entrypoint ./seed api 2>/dev/null) || \
echo "   Uruchom ręcznie: docker compose run --rm --entrypoint ./seed api"

# 8b. Przypisz kraje do modeli (PL, DE, US) + utwórz modele jeśli nie istnieją
echo "[8b/10] Przypisuję kraje do modeli..."
if docker compose $COMPOSE_FILES exec -T postgres psql -U platform -d content_platform < scripts/assign-model-countries.sql 2>/dev/null; then
  echo "   [OK] Kraje przypisane"
else
  echo "   Uruchom ręcznie: bash scripts/vps-assign-countries.sh"
fi

# 9. Przywróć 4 użytkowników (jeśli był dump)
if [[ -f "$DUMP_FILE" && -s "$DUMP_FILE" ]]; then
  echo "[9/10] Przywracam użytkowników: $PROTECTED_EMAILS..."

  docker cp "$DUMP_FILE" $(docker compose $COMPOSE_FILES ps -q postgres):/tmp/restore.dump

  echo "   Przywracam dump do bazy tymczasowej backup_restore..."
  if ! docker compose $COMPOSE_FILES exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres sh -c "
    createdb -U platform backup_restore 2>/dev/null || true
    pg_restore -U platform -d backup_restore --no-owner --no-acl /tmp/restore.dump
  "; then
    echo "   BŁĄD pg_restore - użytkownicy nie zostaną przywróceni"
  else
  pc() { docker compose $COMPOSE_FILES exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres psql -U platform "$@"; }

  # Users — eksport z backup_restore do content_platform
  docker compose $COMPOSE_FILES exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres sh -c "
    psql -U platform -d backup_restore -t -A -c \"
      COPY (SELECT id,email,password,name,discord_id,role,avatar_url,credit_balance,
            COALESCE(is_banned, false),COALESCE(autoplay, false),COALESCE(email_verified, false),
            referral_code,last_login_at,created_at,updated_at
            FROM users WHERE email IN ($PROTECTED_EMAILS_SQL)) TO STDOUT WITH CSV
    \" 2>/dev/null | psql -U platform -d content_platform -c \"
      COPY users(id,email,password,name,discord_id,role,avatar_url,credit_balance,is_banned,autoplay,email_verified,referral_code,last_login_at,created_at,updated_at)
      FROM STDIN WITH CSV
    \" 2>/dev/null
  " || \
  docker compose $COMPOSE_FILES exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres sh -c "
    psql -U platform -d backup_restore -t -A -c \"
      COPY (SELECT id,email,password,name,discord_id,role,avatar_url,credit_balance,last_login_at,created_at,updated_at
            FROM users WHERE email IN ($PROTECTED_EMAILS_SQL)) TO STDOUT WITH CSV
    \" 2>/dev/null | psql -U platform -d content_platform -c \"
      COPY users(id,email,password,name,discord_id,role,avatar_url,credit_balance,last_login_at,created_at,updated_at)
      FROM STDIN WITH CSV
    \" 2>/dev/null
  "

  if pc -d content_platform -t -c "SELECT COUNT(*) FROM users WHERE email IN ($PROTECTED_EMAILS_SQL)" 2>/dev/null | grep -qE '^[1-9]'; then
    echo "   [OK] Użytkownicy przywróceni"
  else
    echo "   (Brak użytkowników w backupie lub błąd)"
  fi

  # Accounts (OAuth)
  docker compose $COMPOSE_FILES exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres sh -c "
    psql -U platform -d backup_restore -t -A -c \"
      COPY (SELECT a.id,a.user_id,a.type,a.provider,a.provider_account_id,a.refresh_token,a.access_token,a.expires_at,a.token_type,a.scope,a.id_token,a.session_state
            FROM accounts a JOIN users u ON u.id=a.user_id AND u.email IN ($PROTECTED_EMAILS_SQL)) TO STDOUT WITH CSV
    \" 2>/dev/null | psql -U platform -d content_platform -c \"
      COPY accounts(id,user_id,type,provider,provider_account_id,refresh_token,access_token,expires_at,token_type,scope,id_token,session_state)
      FROM STDIN WITH CSV
    \" 2>/dev/null
  " && echo "   [OK] Accounts (OAuth)" || true

  # Cleanup
  pc -d postgres -c "DROP DATABASE IF EXISTS backup_restore;" 2>/dev/null
  docker compose $COMPOSE_FILES exec -T postgres rm -f /tmp/restore.dump 2>/dev/null
  fi
else
  echo "[9/10] Brak dumpu - pomijam przywracanie użytkowników"
fi

echo "[10/10] Gotowe."

echo ""
echo "=========================================="
echo "GOTOWE. Rebuild od zera zakończony."
echo "=========================================="
echo "Zachowani użytkownicy: $PROTECTED_EMAILS"
echo ".env zachowany."
echo ""
echo "Sprawdź: docker compose $COMPOSE_FILES ps"
echo "Testuj: https://dyskiof.net"
echo "Usuń backup: rm -rf $BACKUP_DIR"
echo ""
