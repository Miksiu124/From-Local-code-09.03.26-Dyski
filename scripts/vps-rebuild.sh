#!/bin/bash
# ContentVault â€” peĹ‚na przebudowa kontenerĂłw na VPS (zachowanie tylko bazy PostgreSQL)
# Uruchom NA VPS: cd /opt/contentvault && bash scripts/vps-rebuild.sh
# Opcja: --billionmail â€” uĹĽyj docker-compose.billionmail.yml (gdy BillionMail jest zainstalowany)

set -e

COMPOSE_FILES="-f docker-compose.yml"
if [[ "$1" == "--billionmail" ]]; then
  COMPOSE_FILES="-f docker-compose.yml -f docker-compose.billionmail.yml"
  echo "UĹĽywam BillionMail override."
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

echo "=== ContentVault â€” przebudowa od zera (zachowujÄ™ postgres_data) ==="

# 1. Zatrzymaj wszystkie kontenery (bez usuwania wolumenĂłw)
echo "ZatrzymujÄ™ kontenery..."
docker compose $COMPOSE_FILES down

# 2. UsuĹ„ TYLKO wolumen redis (baza postgres zostaje)
# Nazwa wolumenu = prefiks projektu (np. contentvault/contentmanager) + _redis_data
for v in $(docker volume ls -q | grep -E "_redis_data$"); do
  echo "Usuwam wolumen cache: $v"
  docker volume rm "$v" 2>/dev/null || true
done

# 3. Przebuduj obrazy od zera
echo "PrzebudowujÄ™ obrazy (--no-cache)..."
docker compose $COMPOSE_FILES build --no-cache

# 4. Uruchom
echo "Uruchamiam kontenery..."
docker compose $COMPOSE_FILES up -d

echo ""
echo "Gotowe. Baza PostgreSQL zachowana. SprawdĹş: docker compose $COMPOSE_FILES ps"
