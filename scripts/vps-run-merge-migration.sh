#!/bin/bash
# Uruchom na VPS po zakończeniu merge R2.
# Użycie: bash scripts/vps-run-merge-migration.sh
# Lub z poziomu projektu: cd /opt/contentvault && bash scripts/vps-run-merge-migration.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

echo "1. Backup DB..."
docker compose exec postgres pg_dump -U platform content_platform > "backup_pre_merge_$(date +%Y%m%d_%H%M%S).sql"
echo "   Backup zapisany."

echo "2. Migracja DB..."
docker compose exec -T postgres psql -U platform -d content_platform < scripts/merge-r2-folders-migrate-db.sql
echo "   Migracja zakończona."

echo "3. Gotowe. Teraz uruchom: python scripts/merge-r2-folders.py --delete-sources-only (lokalnie z .env)"
