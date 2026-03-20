#!/bin/bash
# Fix meta tags (canonical, og:url) showing localhost instead of production URL.
# Run on VPS after setting NEXT_PUBLIC_APP_URL in .env.
set -e
cd /opt/contentvault
grep -q "NEXT_PUBLIC_APP_URL=https://" .env || {
  echo "Add NEXT_PUBLIC_APP_URL=https://dyskiof.net to .env first"
  exit 1
}
docker compose -f docker-compose.yml -f docker-compose.vps.yml build frontend --no-cache
docker compose -f docker-compose.yml -f docker-compose.vps.yml up -d frontend
echo "Frontend rebuilt. Meta tags should now show production URL."
