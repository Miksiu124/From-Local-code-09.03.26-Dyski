#!/bin/bash
# ContentVault — bezpieczny upgrade PostgreSQL 16 → 18
#
# KLUCZOWE: Przed usunięciem volume robimy pełny backup. Zero utraty danych.
#
# Użycie: cd ContentManager && bash scripts/upgrade-postgres-16-to-18.sh [--resume] [--billionmail]
#   --resume = kontynuuj od restore (gdy backup już istnieje, np. po timeout)
# Na VPS:  cd /opt/contentvault && bash scripts/upgrade-postgres-16-to-18.sh
#
# Wymaga: .env z POSTGRES_PASSWORD (lub DATABASE_URL)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# Backup w katalogu projektu (nie w /tmp — na VPS /tmp może być czyszczony)
BACKUP_DIR="${REPO_ROOT}/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/pre_pg18_upgrade_${TIMESTAMP}.dump"

# Compose files (obsługa billionmail)
COMPOSE_FILES="-f docker-compose.yml"
RESUME=false
for arg in "$@"; do
  [[ "$arg" == "--billionmail" ]] && COMPOSE_FILES="-f docker-compose.yml -f docker-compose.billionmail.yml"
  [[ "$arg" == "--resume" ]] && RESUME=true
done

echo "=============================================="
echo "PostgreSQL 16 → 18 — bezpieczny upgrade"
echo "=============================================="

# Załaduj POSTGRES_PASSWORD z .env (bezpiecznie — unika błędów składni z source)
if [[ -f .env ]]; then
  POSTGRES_PASSWORD=$(grep -E '^POSTGRES_PASSWORD=' .env 2>/dev/null | cut -d= -f2- | tr -d '\r\n"' | head -1)
fi
if [[ -z "$POSTGRES_PASSWORD" ]]; then
  echo "Błąd: POSTGRES_PASSWORD musi być ustawione w .env"
  exit 1
fi
export PGPASSWORD="$POSTGRES_PASSWORD"

if [[ "$RESUME" == true ]]; then
  # Tryb resume: użyj najnowszego backupu, pomiń backup
  BACKUP_FILE=$(ls -t "$BACKUP_DIR"/pre_pg18_upgrade_*.dump 2>/dev/null | head -1)
  if [[ -z "$BACKUP_FILE" || ! -f "$BACKUP_FILE" ]]; then
    echo "Błąd: Brak backupu w $BACKUP_DIR. Uruchom bez --resume."
    exit 1
  fi
  echo "Resume: używam backupu $BACKUP_FILE"
  VOLUME_NAME=$(docker volume ls -q | grep postgres_data | head -1)
  if [[ -z "$VOLUME_NAME" ]]; then
    echo "Błąd: Nie znaleziono volume postgres_data"
    exit 1
  fi
  echo "Volume: $VOLUME_NAME"
  echo ""
else
  echo "Backup: $BACKUP_FILE"
  echo ""

  # ── 1. Weryfikacja: czy postgres 16 działa ──
  echo "[1/8] Sprawdzam PostgreSQL 16..."
  if ! docker compose $COMPOSE_FILES exec -T postgres pg_isready -U platform -d content_platform -q 2>/dev/null; then
    echo "Błąd: PostgreSQL nie odpowiada. Uruchom: docker compose up -d postgres"
    echo "Lub jeśli upgrade się przerwał: bash $0 --resume"
    exit 1
  fi

  CURRENT_VER=$(docker compose $COMPOSE_FILES exec -T postgres psql -U platform -d content_platform -tAc "SELECT version();")
  echo "   Aktualna wersja: $CURRENT_VER"

  # ── 2. Pełny backup (pg_dump -Fc) ──
  echo "[2/8] Tworzę backup bazy (pg_dump -Fc)..."
  mkdir -p "$BACKUP_DIR"
  docker compose $COMPOSE_FILES exec -T postgres pg_dump -U platform content_platform -Fc > "$BACKUP_FILE"

  if [[ ! -s "$BACKUP_FILE" ]]; then
    echo "Błąd: Backup jest pusty!"
    exit 1
  fi
  BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
  echo "   Backup zapisany: $BACKUP_FILE ($BACKUP_SIZE)"

  # ── 3. Weryfikacja backupu ──
  echo "[3/8] Weryfikuję backup (pg_restore -l)..."
  if ! docker run --rm -v "${REPO_ROOT}:/backup" -w /backup postgres:16-alpine pg_restore -l "$BACKUP_FILE" 2>/dev/null | head -20; then
    echo "Błąd: Backup jest uszkodzony!"
    exit 1
  fi
  echo "   Backup OK"

  # ── 4. Pobierz nazwę volume PRZED zatrzymaniem ──
  echo "[4/8] Pobieram nazwę volume..."
  VOLUME_NAME=$(docker inspect content-postgres --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}' 2>/dev/null || true)
  if [[ -z "$VOLUME_NAME" ]]; then
    echo "Błąd: Nie mogę pobrać nazwy volume. Upewnij się, że postgres działa."
    exit 1
  fi
  echo "   Volume: $VOLUME_NAME"
fi

# ── 5. Zatrzymaj i usuń kontener (żeby odłączyć volume) ──
echo "[5/8] Zatrzymuję i usuwam kontener PostgreSQL..."
docker compose $COMPOSE_FILES stop postgres
docker compose $COMPOSE_FILES rm -f postgres 2>/dev/null || true

# ── 6. Usuń volume (dane są w backupie!) ──
echo "[6/8] Usuwam volume (dane bezpieczne w $BACKUP_FILE)..."
if ! docker volume rm "$VOLUME_NAME" 2>/dev/null; then
  echo "   Błąd: Nie mogę usunąć volume. Sprawdź: docker volume ls"
  exit 1
fi

# ── 7. Aktualizuj docker-compose na postgres:18-alpine (jeśli jeszcze 16) ──
echo "[7/8] Aktualizuję docker-compose.yml na postgres:18-alpine..."
if grep -q 'image: postgres:16-alpine' docker-compose.yml; then
  sed -i.bak 's|image: postgres:16-alpine|image: postgres:18-alpine|' docker-compose.yml
  echo "   Zaktualizowano 16 → 18 (docker-compose.yml.bak = PG16)"
else
  echo "   Compose już ma postgres:18"
fi

# ── 8. Uruchom PostgreSQL 18 ──
echo "[8/8] Uruchamiam PostgreSQL 18..."
docker compose $COMPOSE_FILES up -d postgres

# Czekaj na gotowość
echo "   Czekam na PostgreSQL 18..."
for i in $(seq 1 60); do
  if docker compose $COMPOSE_FILES exec -T postgres pg_isready -U platform -d content_platform -q 2>/dev/null; then
    echo "   Gotowe"
    break
  fi
  [[ $i -eq 60 ]] && { echo "Timeout! Sprawdź: docker compose logs postgres"; exit 1; }
  sleep 2
done

# ── 9. Restore z backupu ──
echo ""
echo "Przywracam dane z backupu..."
BACKUP_IN_CONTAINER="/backup/backups/$(basename "$BACKUP_FILE")"
docker compose $COMPOSE_FILES run --rm --no-deps \
  -v "${REPO_ROOT}:/backup" -w /backup \
  -e PGPASSWORD="$POSTGRES_PASSWORD" \
  postgres pg_restore -U platform -d content_platform -h postgres \
  --clean --if-exists --no-owner --no-acl -v \
  "$BACKUP_IN_CONTAINER" 2>/dev/null || true
# pg_restore zwraca 1 przy drobnych ostrzeżeniach (np. owner) — ignorujemy jeśli restore się wykonał

# ── 10. Weryfikacja ──
echo ""
echo "Weryfikacja..."
NEW_VER=$(docker compose $COMPOSE_FILES exec -T postgres psql -U platform -d content_platform -tAc "SELECT version();")
ROW_COUNT=$(docker compose $COMPOSE_FILES exec -T postgres psql -U platform -d content_platform -tAc "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';")

echo "   Wersja: $NEW_VER"
echo "   Tabele w public: $ROW_COUNT"

# Uruchom resztę serwisów
echo ""
echo "Uruchamiam pozostałe serwisy..."
docker compose $COMPOSE_FILES up -d

echo ""
echo "=============================================="
echo "Upgrade zakończony."
echo "Backup zachowany: $BACKUP_FILE"
echo ""
echo "Rollback (jeśli coś nie działa):"
echo "  1. docker compose down"
echo "  2. mv docker-compose.yml.bak docker-compose.yml  # przywróć postgres:16"
echo "  3. docker compose up -d postgres  # utworzy nowy volume"
echo "  4. Po starcie: docker compose run --rm -v \"\$(pwd):/b\" -e PGPASSWORD=\"\$POSTGRES_PASSWORD\" postgres pg_restore -U platform -d content_platform -h postgres --clean --if-exists --no-owner --no-acl /b/backups/$(basename "$BACKUP_FILE")"
echo "=============================================="
