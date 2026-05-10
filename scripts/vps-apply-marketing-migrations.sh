#!/usr/bin/env bash
# Zastosuj migracje marketing (kolumna opt-in + tabele campaign_sends / trigger_fires).
# Uruchom na VPS z katalogu ContentManager (np. /opt/contentvault), gdy baza już istnieje
# (initdb.d nie odpala się ponownie).
#
#   bash scripts/vps-apply-marketing-migrations.sh
#
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG=content-postgres
for f in \
  "$ROOT/backend/migrations/20260428120000_marketing_winback.up.sql" \
  "$ROOT/backend/migrations/20260428133000_marketing_trigger_fires.up.sql" \
  "$ROOT/backend/migrations/20260428140000_promo_min_amount_repeat_buyer.up.sql"
do
  echo "Applying $(basename "$f")..."
  docker exec -i "$PG" psql -U platform -d content_platform < "$f"
done
echo "Done."
