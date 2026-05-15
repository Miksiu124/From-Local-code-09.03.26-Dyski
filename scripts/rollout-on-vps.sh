#!/usr/bin/env bash
# Rolling deploy intended to run ON the VPS inside the ContentManager checkout.
# Uses Docker Compose healthchecks and dynamic nginx upstream resolution (resolver 127.0.0.11 + variable proxy_pass).
#
# Typical CI: GitHub Actions SSH → cd $VPS_PATH → bash scripts/rollout-on-vps.sh
# Env overrides:
#   CONTENTMANAGER_GIT_BRANCH   branch to checkout (default: main / GIT_BRANCH)
#   SKIP_GIT_PULL=1             skip git fetch/pull (reuse when code already synced)
#   CONTENTMANAGER_COMPOSE_WAIT_TIMEOUT  seconds for `docker compose up --wait` (default 900)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=compose-vps-files.sh
source "$SCRIPT_DIR/compose-vps-files.sh"
set_compose_vps_files

BRANCH="${CONTENTMANAGER_GIT_BRANCH:-${GIT_BRANCH:-main}}"
export GIT_TERMINAL_PROMPT=0

wait_timeout_flag() {
	if docker compose up --help 2>&1 | grep -qF -- '--wait-timeout'; then
		echo "--wait-timeout ${CONTENTMANAGER_COMPOSE_WAIT_TIMEOUT:-900}"
	fi
}

echo "=== Rollout on $(hostname -f 2>/dev/null || hostname) ==="
echo "Repo: $ROOT"
echo "Branch: $BRANCH"
echo "Compose: docker compose $COMPOSE_FILES"

if [[ "${SKIP_GIT_PULL:-0}" != "1" ]]; then
	# Align the VPS working tree exactly to origin (-f discards tracked-file edits on the server).
	git fetch origin "$BRANCH"
	git checkout -f -B "$BRANCH" "origin/$BRANCH"
	echo "HEAD: $(git rev-parse HEAD)"
else
	echo "SKIP_GIT_PULL=1 — using working tree as-is"
fi

echo "Compose merge sanity check..."
docker compose $COMPOSE_FILES config >/dev/null

echo "Build app images..."
docker compose $COMPOSE_FILES build api frontend postgres-backup-r2

WT="$(wait_timeout_flag)"

echo "Bring stack up (--wait honours service healthchecks)..."
# shellcheck disable=SC2086
docker compose $COMPOSE_FILES up -d --remove-orphans --build --wait $WT

echo "Apply pending SQL migrations required by latest release..."
MIGRATION_FILE="backend/migrations/20260515154500_social_custom_coinflip_features.up.sql"
if [[ -f "$MIGRATION_FILE" ]]; then
	docker compose $COMPOSE_FILES exec -T postgres \
		psql -U platform -d content_platform -v ON_ERROR_STOP=1 < "$MIGRATION_FILE"
else
	echo "[WARN] Missing migration file: $MIGRATION_FILE"
fi

echo "Verify social/custom/coinflip tables exist..."
docker compose $COMPOSE_FILES exec -T postgres psql -U platform -d content_platform -tAc \
	"SELECT COUNT(*) FROM information_schema.tables WHERE table_name IN ('social_reward_claims','custom_order_requests','coinflip_rounds');" \
	| tr -d '[:space:]' | grep -qx "3"

echo "Reload nginx configs (avoid stale nginx.conf bind-mount inode quirks)..."
docker compose $COMPOSE_FILES up -d --no-deps --force-recreate nginx nginx-exporter 2>/dev/null || true

echo ""
docker compose $COMPOSE_FILES ps
echo "Rollout finished."
