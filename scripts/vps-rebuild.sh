#!/bin/bash
# Dyskiof — pełna przebudowa kontenerów na VPS (zachowanie tylko bazy PostgreSQL)
# Uruchom NA VPS: cd /opt/contentvault && bash scripts/vps-rebuild.sh
#
# Wolumeny: ta sama logika co deploy-vps / vps-up-prod (klaster + LGTM) — patrz scripts/compose-vps-files.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=compose-vps-files.sh
source "$SCRIPT_DIR/compose-vps-files.sh"
set_compose_vps_files "$@"

echo "=== Dyskiof — przebudowa od zera (zachowuję dane PostgreSQL) ==="
echo "Compose: $COMPOSE_FILES"
echo ""

# 1. Zatrzymaj wszystkie kontenery (bez usuwania wolumenów)
echo "Zatrzymuję kontenery..."
docker compose $COMPOSE_FILES down

# 2. Usuń TYLKO wolumen redis (baza postgres zostaje)
# Nazwa wolumenu = prefiks projektu (np. contentvault/contentmanager) + _redis_data
for v in $(docker volume ls -q | grep -E "_redis_data$"); do
  echo "Usuwam wolumen cache: $v"
  docker volume rm "$v" 2>/dev/null || true
done

# 3. Przebuduj obrazy od zera
echo "Przebudowuję obrazy (--no-cache)..."
docker compose $COMPOSE_FILES build --no-cache

# 4. Uruchom
echo "Uruchamiam kontenery..."
if [[ "$COMPOSE_FILES" == *"docker-compose.lgtm.yml"* ]]; then
  [ -f .env.lgtm ] || cp .env.lgtm.example .env.lgtm
fi
docker compose $COMPOSE_FILES up -d
(docker compose $COMPOSE_FILES up -d --no-deps --force-recreate nginx 2>/dev/null) || true

echo ""
echo "Gotowe. Baza PostgreSQL zachowana. Sprawdź: docker compose $COMPOSE_FILES ps"
