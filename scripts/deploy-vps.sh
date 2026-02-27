#!/bin/bash
# ContentVault — deploy na VPS
# Użycie: ./scripts/deploy-vps.sh [--build]
# Wymaga: rsync, ssh

set -e

VPS_USER="${VPS_USER:-marek}"
VPS_HOST="${VPS_HOST:-136.114.88.152}"
VPS_PATH="${VPS_PATH:-/opt/contentvault}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== ContentVault deploy ==="
echo "Host: $VPS_USER@$VPS_HOST:$VPS_PATH"
echo ""

# Sync plików (bez node_modules, .next, .git)
echo "Syncing..."
rsync -avz --delete \
  --exclude node_modules \
  --exclude .next \
  --exclude .git \
  --exclude uploads \
  --exclude '*.log' \
  --exclude '.env.local' \
  "$REPO_ROOT/" "$VPS_USER@$VPS_HOST:$VPS_PATH/"

echo ""
echo "Starting on VPS..."

if [[ "$1" == "--build" ]]; then
  ssh "$VPS_USER@$VPS_HOST" "cd $VPS_PATH && docker compose build && docker compose up -d"
else
  ssh "$VPS_USER@$VPS_HOST" "cd $VPS_PATH && docker compose up -d"
fi

echo ""
echo "Done. Check: https://dyskiof.net"
