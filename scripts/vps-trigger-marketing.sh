#!/usr/bin/env bash
# Run on VPS from /opt/contentvault: optional MARKETING_OPS_KEY in env; else read/create in .env.
# Calls POST /api/ops/marketing/run-cron (needs MARKETING_OPS_KEY in API env).
set -eu
cd "$(dirname "$0")/.."
KEY="${MARKETING_OPS_KEY:-}"
if [[ -z "$KEY" ]] && [[ -f .env ]]; then
  KEY="$(grep -E '^MARKETING_OPS_KEY=' .env | tail -1 | cut -d= -f2- | tr -d '\r' || true)"
fi
if [[ -z "$KEY" ]]; then
  KEY="$(openssl rand -hex 32)"
  sed -i '/^MARKETING_OPS_KEY=/d' .env 2>/dev/null || true
  echo "MARKETING_OPS_KEY=$KEY" >> .env
  echo "[vps-trigger-marketing] wrote new MARKETING_OPS_KEY to .env (keep secret)."
fi
# shellcheck disable=SC1091
source scripts/compose-vps-files.sh
set_compose_vps_files
docker compose $COMPOSE_FILES up -d --no-deps --force-recreate api
echo "[vps-trigger-marketing] waiting for API..."
sleep 18
BASE="${MARKETING_TRIGGER_BASE_URL:-}"
if [[ -z "$BASE" ]] && [[ -f .env ]]; then
  BASE="$(grep -E '^FRONTEND_URL=' .env | tail -1 | cut -d= -f2- | tr -d '\r' || true)"
fi
if [[ -z "$BASE" ]]; then
  BASE="https://dyskiof.net"
fi
BASE="${BASE%/}"
HDR="Authorization: Bearer ${KEY}"
docker compose $COMPOSE_FILES exec -T nginx wget -qO- \
  --header="$HDR" \
  --post-data="" \
  "http://api:8080/api/ops/marketing/run-cron" || true
echo
echo "[vps-trigger-marketing] done."
