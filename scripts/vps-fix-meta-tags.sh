#!/bin/bash
# Fix meta tags (canonical, og:url) showing localhost instead of production URL.
# Run on VPS after setting NEXT_PUBLIC_APP_URL in .env.
set -e
cd /opt/contentvault
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=compose-vps-files.sh
source "$SCRIPT_DIR/compose-vps-files.sh"
set_compose_vps_files
grep -q "NEXT_PUBLIC_APP_URL=https://" .env || {
  echo "Add NEXT_PUBLIC_APP_URL=https://dyskiof.net to .env first"
  exit 1
}
docker compose $COMPOSE_FILES build frontend --no-cache
docker compose $COMPOSE_FILES up -d frontend
echo "Frontend rebuilt. Meta tags should now show production URL."
