#!/usr/bin/env bash
# Dyskiof — bezpieczny backup PostgreSQL i opcjonalne skopiowanie danych z INNEGO volume
# (bez usuwania żadnych volume — stare dane zostają na dysku).
#
# Na VPS: cd /opt/contentvault
#
#   1) Tylko backup działającej bazy + lista volume:
#        bash scripts/vps-postgres-backup-and-switch-volume-safe.sh
#
#   2) Backup + logiczny zrzut z wybranego volume (tymczasowy kontener) + restore do obecnej bazy:
#        SOURCE_PG_VOLUME=nazwa bash scripts/vps-postgres-backup-and-switch-volume-safe.sh --restore-from-volume
#
# Przed restore skrypt zatrzymuje api i frontend (krótko), żeby uniknąć konfliktów połączeń.
# Wymaga: .env z POSTGRES_PASSWORD; obraz postgres na hoście (docker pull postgres:18-alpine).
#
# Główny volume aplikacji to zwykle: contentvault_postgres_data
# Jeśli drugi „pełny” katalog ma inną wersję PostgreSQL, ustaw: SOURCE_PG_IMAGE=postgres:16-alpine

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=compose-vps-files.sh
source "$SCRIPT_DIR/compose-vps-files.sh"
set_compose_vps_files
BACKUP_ROOT="${REPO_ROOT}/backups"
TS="$(date +%Y%m%d_%H%M%S)"
RUN_DIR="${BACKUP_ROOT}/safe_pg_${TS}"
RESTORE_FROM_VOLUME=false

for arg in "$@"; do
  [[ "$arg" == "--restore-from-volume" ]] && RESTORE_FROM_VOLUME=true
done

mkdir -p "$RUN_DIR"

echo "=============================================="
echo "Dyskiof — bezpieczny backup / restore"
echo "Katalog run: $RUN_DIR"
echo "=============================================="

if [[ -f .env ]]; then
  POSTGRES_PASSWORD=$(grep -E '^POSTGRES_PASSWORD=' .env 2>/dev/null | cut -d= -f2- | tr -d '\r\n"' | head -1)
fi
if [[ -z "${POSTGRES_PASSWORD:-}" ]]; then
  echo "Błąd: POSTGRES_PASSWORD w .env"
  exit 1
fi
export PGPASSWORD="$POSTGRES_PASSWORD"

echo ""
echo "[1] Mount aktualnego Postgresa (content-postgres):"
docker inspect content-postgres --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}} -> {{.Source}}{{println}}{{end}}{{end}}' 2>/dev/null | tee "$RUN_DIR/current_pg_mount.txt" || true

echo ""
echo "[2] Wolumeny Docker + rozmiar _data:"
while read -r vol; do
  [[ -z "$vol" ]] && continue
  sz="$(du -sh "/var/lib/docker/volumes/${vol}/_data" 2>/dev/null | cut -f1 || echo "?")"
  printf "%-60s %s\n" "$vol" "$sz"
done < <(docker volume ls -q) | tee "$RUN_DIR/docker_volumes_sizes.txt"

echo ""
echo "[3] pg_dump działającej bazy (format custom -Fc):"
DUMP_CUR="${RUN_DIR}/content_platform_running_${TS}.dump"
if docker compose $COMPOSE_FILES exec -T postgres pg_isready -U platform -d content_platform -q 2>/dev/null; then
  docker compose $COMPOSE_FILES exec -T postgres pg_dump -U platform content_platform -Fc -f /tmp/cur.dump
  docker compose $COMPOSE_FILES cp postgres:/tmp/cur.dump "$DUMP_CUR"
  docker compose $COMPOSE_FILES exec -T postgres rm -f /tmp/cur.dump
  ls -lh "$DUMP_CUR"
  echo "   OK: $DUMP_CUR"
else
  echo "   OSTRZEŻENIE: Postgres nie odpowiada — pomijam pg_dump."
fi

cp -a docker-compose.yml "${RUN_DIR}/docker-compose.yml.snapshot" 2>/dev/null || true

echo ""
echo "Nic nie zostało usunięte (żadnego docker volume rm)."
echo "Logi: $RUN_DIR"

if [[ "$RESTORE_FROM_VOLUME" != true ]]; then
  echo ""
  echo "Koniec trybu „tylko backup”."
  echo "Aby wgrać dane z innego volume (bez kasowania starych volume):"
  echo "  SOURCE_PG_VOLUME=nazwa_wolumenu bash scripts/$(basename "$0") --restore-from-volume"
  echo "Opcjonalnie, gdy katalog danych jest z PG 16: SOURCE_PG_IMAGE=postgres:16-alpine ..."
  exit 0
fi

SOURCE_PG_VOLUME="${SOURCE_PG_VOLUME:-}"
if [[ -z "$SOURCE_PG_VOLUME" ]]; then
  echo "Błąd: ustaw SOURCE_PG_VOLUME=nazwa (np. contentvault_postgres_data lub drugi volume)"
  exit 1
fi

if ! docker volume inspect "$SOURCE_PG_VOLUME" &>/dev/null; then
  echo "Błąd: brak volume: $SOURCE_PG_VOLUME"
  exit 1
fi

SOURCE_PG_IMAGE="${SOURCE_PG_IMAGE:-postgres:18-alpine}"
TEMP_NAME="pg-src-temp-${TS}"

echo ""
echo "[4] Tymczasowy Postgres z volume źródłowym: $SOURCE_PG_VOLUME (obraz: $SOURCE_PG_IMAGE)"
docker rm -f "$TEMP_NAME" 2>/dev/null || true
docker run -d --name "$TEMP_NAME" \
  -e POSTGRES_PASSWORD="${POSTGRES_PASSWORD}" \
  -e POSTGRES_USER=platform \
  -e POSTGRES_DB=content_platform \
  -v "${SOURCE_PG_VOLUME}:/var/lib/postgresql/data" \
  "$SOURCE_PG_IMAGE" >/dev/null

cleanup() { docker rm -f "$TEMP_NAME" 2>/dev/null || true; }
trap cleanup EXIT

echo "   Czekam na gotowość źródła..."
for i in $(seq 1 90); do
  if docker exec "$TEMP_NAME" pg_isready -U platform -d content_platform -q 2>/dev/null; then
    echo "   Źródło OK"
    break
  fi
  if [[ $i -eq 90 ]]; then
    echo "Błąd: źródłowy Postgres nie wstał. Sprawdź wersję danych (SOURCE_PG_IMAGE?) i logi: docker logs $TEMP_NAME"
    exit 1
  fi
  sleep 1
done

CURRENT_VOL="$(docker inspect content-postgres --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}' 2>/dev/null || true)"
if [[ -n "$CURRENT_VOL" && "$SOURCE_PG_VOLUME" == "$CURRENT_VOL" ]]; then
  echo "Błąd: SOURCE_PG_VOLUME jest tym samym co aktywny mount ($CURRENT_VOL). Wybierz INNY volume ze starszą kopią danych."
  exit 1
fi

DUMP_SRC="${RUN_DIR}/content_platform_from_${SOURCE_PG_VOLUME}_${TS}.dump"
echo ""
echo "[5] pg_dump ze źródła (docker exec w $TEMP_NAME)..."
docker exec "$TEMP_NAME" pg_dump -U platform content_platform -Fc -f /tmp/src.dump
docker cp "$TEMP_NAME:/tmp/src.dump" "$DUMP_SRC"
docker exec "$TEMP_NAME" rm -f /tmp/src.dump
ls -lh "$DUMP_SRC"

trap - EXIT
cleanup

echo ""
echo "[6] Krótki stop api + frontend; restore do głównego Postgresa..."
docker compose $COMPOSE_FILES stop api frontend 2>/dev/null || true

docker cp "$DUMP_SRC" content-postgres:/tmp/restore.dump
docker compose $COMPOSE_FILES exec -T postgres \
  pg_restore -U platform -d content_platform --clean --if-exists --no-owner --no-acl -v /tmp/restore.dump 2>/dev/null \
  || docker compose $COMPOSE_FILES exec -T postgres \
    pg_restore -U platform -d content_platform --if-exists --no-owner --no-acl /tmp/restore.dump || true

docker compose $COMPOSE_FILES exec -T postgres rm -f /tmp/restore.dump

docker compose $COMPOSE_FILES up -d api frontend

echo ""
echo "[7] Weryfikacja (liczby wierszy):"
docker compose $COMPOSE_FILES exec -T postgres psql -U platform -d content_platform -c \
  "SELECT (SELECT count(*) FROM models) AS models, (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM content_items) AS content_items;" || true

echo ""
echo "Gotowe. Sprawdź stronę. Jeśli coś jest nie tak, masz dumpy w: $RUN_DIR"
echo "(Rollback: przywróć wcześniejszy stan z $DUMP_CUR przez pg_restore — instrukcja w DEPLOY.md / backup)."
