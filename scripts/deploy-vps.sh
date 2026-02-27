#!/bin/bash
# ContentVault — deploy na VPS
# Użycie: ./scripts/deploy-vps.sh [--build] [--rebuild] [--billionmail]
#   --build      = sync + docker compose build + up
#   --rebuild    = sync + pełna przebudowa od zera (zachowuje tylko postgres_data)
#   --billionmail= użyj docker-compose.billionmail.yml
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
BILLIONMAIL=""
for arg in "$@"; do
  [[ "$arg" == "--rebuild" ]] && REBUILD=true
  [[ "$arg" == "--billionmail" ]] && BILLIONMAIL="--billionmail"
done

echo "=== ContentVault deploy ==="
echo "Host: $VPS_USER@$VPS_HOST:$VPS_PATH"
[[ "$REBUILD" == true ]] && echo "Tryb: PEŁNA PRZEBUDOWA (zachowuję postgres_data)"
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

COMPOSE_FILES="-f docker-compose.yml"
[[ -n "$BILLIONMAIL" ]] && COMPOSE_FILES="-f docker-compose.yml -f docker-compose.billionmail.yml"

if [[ "$REBUILD" == true ]]; then
  ssh "$VPS_USER@$VPS_HOST" "cd $VPS_PATH && bash scripts/vps-rebuild.sh $BILLIONMAIL"
elif [[ "$1" == "--build" ]]; then
  ssh "$VPS_USER@$VPS_HOST" "cd $VPS_PATH && docker compose $COMPOSE_FILES build && docker compose $COMPOSE_FILES up -d"
else
  ssh "$VPS_USER@$VPS_HOST" "cd $VPS_PATH && docker compose $COMPOSE_FILES up -d"
fi

echo ""
echo "Done. Check: https://dyskiof.net"
