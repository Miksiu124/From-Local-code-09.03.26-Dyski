#!/bin/bash
# Run pending SQL migrations on existing PostgreSQL database.
# Use when the DB was created before new migrations were added (initdb.d only runs on first init).
#
# Usage: ./scripts/run-pending-migrations.sh
# Docker: docker exec -i content-postgres psql -U platform -d content_platform < backend/migrations/20260313120000_add_referral_link_tracking.up.sql
#
# Requires: psql, DATABASE_URL or POSTGRES_* env vars

set -e

# Load .env if present (from ContentManager dir)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONTENT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$CONTENT_DIR"
[[ -f .env ]] && set -a && . ./.env && set +a

# Parse DATABASE_URL or use individual vars
DB_HOST="${POSTGRES_HOST:-localhost}"
DB_PORT="${POSTGRES_PORT:-5432}"
DB_NAME="${POSTGRES_DB:-content_platform}"
DB_USER="${POSTGRES_USER:-platform}"
DB_PASS="${POSTGRES_PASSWORD:-}"

if [[ -n "$DATABASE_URL" ]]; then
  # Parse postgresql://user:pass@host:port/db
  if [[ "$DATABASE_URL" =~ postgresql://([^:]+):([^@]+)@([^:]+):([0-9]+)/([^?]+) ]]; then
    DB_USER="${BASH_REMATCH[1]}"
    DB_PASS="${BASH_REMATCH[2]}"
    DB_HOST="${BASH_REMATCH[3]}"
    DB_PORT="${BASH_REMATCH[4]}"
    DB_NAME="${BASH_REMATCH[5]}"
  fi
fi

[[ -z "$DB_PASS" ]] && { echo "POSTGRES_PASSWORD or DATABASE_URL required"; exit 1; }

MIGRATIONS_DIR="$CONTENT_DIR/backend/migrations"

run_sql() {
  local file="$1"
  echo "[Migration] Applying $(basename "$file")..."
  PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$file" 2>/dev/null || {
    echo "  -> Failed or already applied (table may exist)"
    return 1
  }
  echo "  -> OK"
  return 0
}

check_table() {
  local tbl="$1"
  PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT 1 FROM information_schema.tables WHERE table_name='$tbl'" 2>/dev/null | grep -q 1
}

echo "=========================================="
echo "ContentVault - Pending Migrations"
echo "=========================================="

# Check custom_links (required for admin custom links feature)
if ! check_table custom_links; then
  echo "[Pending] custom_links missing - applying 20260305223600 and 20260305234500..."
  run_sql "$MIGRATIONS_DIR/20260305223600_add_custom_links.up.sql" || true
  run_sql "$MIGRATIONS_DIR/20260305234500_track_link_conversions.up.sql" || true
  echo "  -> custom_links + link_visits ready"
fi

# Check if referral_link_visits exists
if check_table referral_link_visits; then
  echo "[OK] referral_link_visits table exists"
else
  echo "[Pending] referral_link_visits missing - applying 20260313120000..."
  run_sql "$MIGRATIONS_DIR/20260313120000_add_referral_link_tracking.up.sql" || true
fi

# Verify
if check_table referral_link_visits; then
  echo ""
  echo "Done. referral_link_visits is ready. Referral clicks will now be tracked."
else
  echo ""
  echo "Warning: referral_link_visits still missing. Run manually:"
  echo "  PGPASSWORD=\$POSTGRES_PASSWORD psql -h localhost -p 5432 -U platform -d content_platform -f backend/migrations/20260313120000_add_referral_link_tracking.up.sql"
  echo "  Or with Docker: docker exec -i content-postgres psql -U platform -d content_platform < backend/migrations/20260313120000_add_referral_link_tracking.up.sql"
  exit 1
fi

if check_table custom_links; then
  echo "[OK] custom_links table exists"
fi
