#!/bin/bash
# ContentVault — deploy na VPS
# Użycie: ./scripts/deploy-vps.sh [--build] [--rebuild] [--rebuild-fresh] [--pg-upgrade] [--billionmail]
#   --build        = sync + docker compose build + up
#   --rebuild      = sync + pełna przebudowa od zera (zachowuje tylko postgres_data)
#   --rebuild-fresh= sync + przebudowa OD ZERA z bazą (zachowuje 4 użytkowników + .env)
#   --pg-upgrade   = sync + upgrade PostgreSQL 16→18 (backup-first, zero utraty danych)
#   --pg-resume   = sync + upgrade --resume (gdy poprzedni upgrade się przerwał)
#   --billionmail  = użyj docker-compose.billionmail.yml
# Wymaga: rsync, ssh
# Przed: export VPS_HOST=... (lub: [ -f .env.deploy ] && set -a && . ./.env.deploy && set +a)

set -e

# IP/host NIE w repo - VPS_HOST wymagane
VPS_USER="${VPS_USER:-marek}"
VPS_HOST="${VPS_HOST:?Set VPS_HOST (e.g. export VPS_HOST=your-vps.example.com)}"
VPS_PATH="${VPS_PATH:-/opt/contentvault}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

REBUILD=false
REBUILD_FRESH=false
PG_UPGRADE=false
PG_RESUME=false
BILLIONMAIL=""
for arg in "$@"; do
  [[ "$arg" == "--rebuild" ]] && REBUILD=true
  [[ "$arg" == "--rebuild-fresh" ]] && REBUILD_FRESH=true
  [[ "$arg" == "--pg-upgrade" ]] && PG_UPGRADE=true
  [[ "$arg" == "--pg-resume" ]] && PG_UPGRADE=true && PG_RESUME=true
  [[ "$arg" == "--billionmail" ]] && BILLIONMAIL="--billionmail"
done

echo "=== ContentVault deploy ==="
echo "Host: $VPS_USER@$VPS_HOST:$VPS_PATH"
[[ "$REBUILD" == true ]] && echo "Tryb: PEŁNA PRZEBUDOWA (zachowuję postgres_data)"
[[ "$REBUILD_FRESH" == true ]] && echo "Tryb: REBUILD OD ZERA (fresh DB, zachowuję 4 użytkowników + .env)"
[[ "$PG_UPGRADE" == true ]] && echo "Tryb: UPGRADE PostgreSQL 16→18 (backup-first, zero utraty danych)"
[[ "$PG_RESUME" == true ]] && echo "Tryb: UPGRADE --resume (kontynuuj od restore)"
echo ""

# Sync plików (bez node_modules, .next, .git)
echo "Syncing..."
rsync -avz --delete \
  --exclude node_modules \
  --exclude .next \
  --exclude .git \
  --exclude uploads \
  --exclude '*.log' \
  --exclude '.env' \
  --exclude '.env.local' \
  "$REPO_ROOT/" "$VPS_USER@$VPS_HOST:$VPS_PATH/"

echo ""
echo "Starting on VPS..."

# VPS: zawsze docker-compose.vps.yml → nginx.conf.production (bez polegania na NGINX_CONFIG w .env)
COMPOSE_FILES="-f docker-compose.yml -f docker-compose.vps.yml"
[[ -n "$BILLIONMAIL" ]] && COMPOSE_FILES="-f docker-compose.yml -f docker-compose.billionmail.yml -f docker-compose.vps.yml"

if [[ "$REBUILD_FRESH" == true ]]; then
  ssh "$VPS_USER@$VPS_HOST" "cd $VPS_PATH && bash scripts/vps-rebuild-fresh.sh $BILLIONMAIL"
elif [[ "$REBUILD" == true ]]; then
  ssh "$VPS_USER@$VPS_HOST" "cd $VPS_PATH && bash scripts/vps-rebuild.sh $BILLIONMAIL"
elif [[ "$PG_UPGRADE" == true ]]; then
  RESUME_ARG=""
  [[ "$PG_RESUME" == true ]] && RESUME_ARG="--resume "
  ssh "$VPS_USER@$VPS_HOST" "cd $VPS_PATH && bash scripts/upgrade-postgres-16-to-18.sh ${RESUME_ARG}$BILLIONMAIL"
elif [[ "$1" == "--build" ]]; then
  ssh "$VPS_USER@$VPS_HOST" "cd $VPS_PATH && docker compose $COMPOSE_FILES build && docker compose $COMPOSE_FILES up -d"
else
  ssh "$VPS_USER@$VPS_HOST" "cd $VPS_PATH && docker compose $COMPOSE_FILES up -d"
fi

echo ""
echo "Done. Check: https://dyskiof.net"
