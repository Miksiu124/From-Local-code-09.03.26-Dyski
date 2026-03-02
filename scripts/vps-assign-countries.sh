#!/bin/bash
# Przypisuje modelki do krajow (DE, US, PL) na VPS
# Uruchom: cd /opt/contentvault && bash scripts/vps-assign-countries.sh

set -e
cd "$(dirname "$0")/.."
source .env 2>/dev/null || true

echo "Sprawdzam kraje i przypisuje modelki..."
docker compose exec -T postgres psql -U platform -d content_platform < scripts/assign-model-countries.sql
echo "Gotowe."
