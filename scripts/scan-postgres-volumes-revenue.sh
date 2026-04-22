#!/usr/bin/env bash
# Na VPS: porównaj SUM(credit_purchases.amount) APPROVED per wolumen Postgres (różne layouty PGDATA).
# Użycie: cd /opt/contentvault && POSTGRES_PASSWORD=... bash scripts/scan-postgres-volumes-revenue.sh
# Albo: hasło wczytane z .env (POSTGRES_PASSWORD=)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# Nie source calego .env (moga byc znaki niedozwolone w bash); tylko haslo.
if [[ -z "${POSTGRES_PASSWORD:-}" && -f "$REPO_ROOT/.env" ]]; then
  POSTGRES_PASSWORD="$(grep -E '^[[:space:]]*POSTGRES_PASSWORD=' "$REPO_ROOT/.env" | head -1 | cut -d= -f2- | tr -d '\r' | sed 's/^[[:space:]]*"\{0,1\}//;s/"\{0,1\}[[:space:]]*$//')"
fi

if [[ -z "${POSTGRES_PASSWORD:-}" ]]; then
  echo "Brak POSTGRES_PASSWORD (export lub wiersz POSTGRES_PASSWORD= w $REPO_ROOT/.env)" >&2
  exit 1
fi

PG_PASS="$POSTGRES_PASSWORD"
SCAN_NAME="pg-revenue-scan-$$"
TARGET="${1:-}" # opcjonalnie: 4435 — podświetl dopasowanie

# Lista kandydatów: nazwa w `docker volume ls`
CANDIDATES=(
  "contentvault_postgres_cluster"
  "contentvault_postgres_data"
  "contentvault_postgres_data_backup_pre_18docker"
)

cleanup() {
  docker rm -f "$SCAN_NAME" 2>/dev/null || true
}
trap cleanup EXIT

vol_layout() {
  local vol="$1"
  docker run --rm -v "$vol":/v alpine:3.20 sh -c '
    if [ -d /v/18/docker ]; then echo cluster; exit 0; fi
    if [ -d /v/data ]; then echo data; exit 0; fi
    if [ -f /v/PG_VERSION ] || [ -d /v/pg_wal ] || [ -d /v/global ]; then echo flat; exit 0; fi
    echo unknown
  '
}

run_scan() {
  local vol="$1"
  if ! docker volume inspect "$vol" &>/dev/null; then
    printf "%s\tMISSING\n" "$vol"
    return
  fi
  local layout
  layout="$(vol_layout "$vol")"

  docker rm -f "$SCAN_NAME" 2>/dev/null || true

  case "$layout" in
    cluster)
      docker run -d --name "$SCAN_NAME" \
        -e POSTGRES_USER=platform \
        -e POSTGRES_PASSWORD="$PG_PASS" \
        -e POSTGRES_DB=content_platform \
        -e PGDATA=/var/lib/postgresql/18/docker \
        -v "$vol":/var/lib/postgresql \
        postgres:18-alpine >/dev/null
      ;;
    data)
      docker run -d --name "$SCAN_NAME" \
        -e POSTGRES_USER=platform \
        -e POSTGRES_PASSWORD="$PG_PASS" \
        -e POSTGRES_DB=content_platform \
        -e PGDATA=/var/lib/postgresql/data/data \
        -v "$vol":/var/lib/postgresql/data \
        postgres:18-alpine >/dev/null
      ;;
    flat)
      # wolumen = bezpośrednio PGDATA (rzadki przypadek)
      docker run -d --name "$SCAN_NAME" \
        -e POSTGRES_USER=platform \
        -e POSTGRES_PASSWORD="$PG_PASS" \
        -e POSTGRES_DB=content_platform \
        -e PGDATA=/var/lib/postgresql/data \
        -v "$vol":/var/lib/postgresql/data \
        postgres:18-alpine >/dev/null
      ;;
    *)
      printf "%s\tlayout=%s\t(cannot start)\n" "$vol" "$layout"
      return
      ;;
  esac

  local i
  for i in $(seq 1 90); do
    if docker exec "$SCAN_NAME" pg_isready -U platform -d content_platform &>/dev/null; then
      break
    fi
    sleep 1
  done
  if ! docker exec "$SCAN_NAME" pg_isready -U platform -d content_platform &>/dev/null; then
    printf "%s\tlayout=%s\tTIMEOUT_START\n" "$vol" "$layout"
    return
  fi

  local rev
  rev="$(docker exec "$SCAN_NAME" psql -U platform -d content_platform -t -A -c \
    "SELECT COALESCE(ROUND(SUM(amount)::numeric, 2), 0) FROM credit_purchases WHERE status = 'APPROVED';" 2>&1)" || rev="ERR"

  if echo "$rev" | grep -qE '^(ERROR|FATAL)'; then
    rev="SQL_ERR"
  fi

  printf "%s\tlayout=%s\trevenue_PLN=%s\n" "$vol" "$layout" "$rev"
}

echo "VOLUME	layout	revenue_approved (credit_purchases)"
echo "---------------------------------------------------"

for v in "${CANDIDATES[@]}"; do
  run_scan "$v" || true
  docker rm -f "$SCAN_NAME" 2>/dev/null || true
done

if [[ -n "$TARGET" ]]; then
  echo ""
  echo "Szukam dopasowania do sumy ~$TARGET PLN (dokładnie w kolumnie revenue)."
fi
