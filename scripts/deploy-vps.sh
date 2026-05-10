#!/bin/bash
# Dyskiof — deploy na VPS
# Użycie: ./scripts/deploy-vps.sh [--pull] [--build] [--rebuild] [--rebuild-fresh] [--pg-upgrade] [--lgtm]
#   --pull         = zamiast rsync: na VPS git pull (wymaga repo + remote GitHub); opcjonalnie GIT_BRANCH=main
#   --build        = (rsync lub --pull) + docker compose build + up
#   --rebuild      = (rsync lub --pull) + pełna przebudowa od zera (zachowuje tylko postgres_data)
#   --rebuild-fresh= (rsync lub --pull) + przebudowa OD ZERA z bazą (zachowuje 4 użytkowników + .env)
#   --pg-upgrade   = (rsync lub --pull) + upgrade PostgreSQL 16→18 (backup-first, zero utraty danych)
#   --pg-resume   = (rsync lub --pull) + upgrade --resume (gdy poprzedni upgrade się przerwał)
#   --lgtm         = grafana/otel-lgtm; brak .env.lgtm → kopia z .env.lgtm.example
# Wymaga: rsync, ssh
# Polaczenie: domyslnie z ContentManager/.env.deploy (VPS_HOST, VPS_USER, VPS_PATH). Mozesz nadpisac zmienne srodowiskowe.
# CI/GitHub Actions: automatycznie odpala na serwerze `scripts/rollout-on-vps.sh` (.github/workflows/deploy.yml).
# Wolumen Postgresa / LGTM: skrypt na serwerze wczytuje scripts/compose-vps-files.sh (jak vps-rebuild) —
# użyj .env / .env.vps (VPS_USE_POSTGRES_CLUSTER, COMPOSE_FILE=...) albo lokalny .env.deploy tylko do tego logu.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ -f "$REPO_ROOT/.env.deploy" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$REPO_ROOT/.env.deploy"
  set +a
fi

# IP/host: z .env.deploy lub export VPS_HOST=... przed uruchomieniem
VPS_USER="${VPS_USER:-marek}"
VPS_HOST="${VPS_HOST:?Set VPS_HOST in .env.deploy or export VPS_HOST=...}"
VPS_PATH="${VPS_PATH:-/opt/contentvault}"

REBUILD=false
REBUILD_FRESH=false
PG_UPGRADE=false
PG_RESUME=false
LGTM=false
DO_BUILD=false
GIT_PULL=false
for arg in "$@"; do
  [[ "$arg" == "--pull" ]] && GIT_PULL=true
  [[ "$arg" == "--rebuild" ]] && REBUILD=true
  [[ "$arg" == "--rebuild-fresh" ]] && REBUILD_FRESH=true
  [[ "$arg" == "--pg-upgrade" ]] && PG_UPGRADE=true
  [[ "$arg" == "--pg-resume" ]] && PG_UPGRADE=true && PG_RESUME=true
  [[ "$arg" == "--lgtm" ]] && LGTM=true
  [[ "$arg" == "--build" ]] && DO_BUILD=true
done

GIT_BRANCH="${GIT_BRANCH:-main}"

echo "=== Dyskiof deploy ==="
echo "Host: $VPS_USER@$VPS_HOST:$VPS_PATH"
[[ "$GIT_PULL" == true ]] && echo "Tryb: git pull na VPS (branch: $GIT_BRANCH, bez rsync)"
[[ "$REBUILD" == true ]] && echo "Tryb: PEŁNA PRZEBUDOWA (zachowuję postgres_data)"
[[ "$REBUILD_FRESH" == true ]] && echo "Tryb: REBUILD OD ZERA (fresh DB, zachowuję 4 użytkowników + .env)"
[[ "$PG_UPGRADE" == true ]] && echo "Tryb: UPGRADE PostgreSQL 16→18 (backup-first, zero utraty danych)"
[[ "$PG_RESUME" == true ]] && echo "Tryb: UPGRADE --resume (kontynuuj od restore)"
[[ "$LGTM" == true ]] && echo "LGTM: wymuszenie --lgtm w compose (poza tym: .env.lgtm / VPS_USE_LGTM na serwerze)"
USE_PG="${VPS_USE_POSTGRES_CLUSTER:-}"
if [[ "$USE_PG" == "1" || "$USE_PG" == "true" || "$USE_PG" == "yes" ]]; then
  echo "Info (lokalny .env.deploy): VPS_USE_POSTGRES_CLUSTER — na serwerze i tak ładuje scripts/compose-vps-files.sh"
fi
echo ""

if [[ "$GIT_PULL" == true ]]; then
  echo "Git pull on VPS ($GIT_BRANCH)..."
  # shellcheck disable=SC2029
  ssh "$VPS_USER@$VPS_HOST" "cd $VPS_PATH && git fetch origin && git checkout $GIT_BRANCH && git pull --ff-only origin $GIT_BRANCH"
else
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
fi

echo ""
echo "Starting on VPS..."

LGTM_F=""
[[ "$LGTM" == true ]] && LGTM_F="--lgtm"

# Na serwerze: ta sama lista plików co vps-rebuild (scripts/compose-vps-files.sh)
REMOTE_COMPOSE='source scripts/compose-vps-files.sh && set_compose_vps_files'
REMOTE_PREP="${REMOTE_COMPOSE} ${LGTM_F} && if [[ \"\$COMPOSE_FILES\" == *lgtm.yml* ]] && [ ! -f .env.lgtm ]; then cp .env.lgtm.example .env.lgtm; fi"

if [[ "$REBUILD_FRESH" == true ]]; then
  ssh "$VPS_USER@$VPS_HOST" "cd $VPS_PATH && bash scripts/vps-rebuild-fresh.sh $LGTM_F"
elif [[ "$REBUILD" == true ]]; then
  ssh "$VPS_USER@$VPS_HOST" "cd $VPS_PATH && bash scripts/vps-rebuild.sh $LGTM_F"
elif [[ "$PG_UPGRADE" == true ]]; then
  RESUME_ARG=""
  [[ "$PG_RESUME" == true ]] && RESUME_ARG="--resume "
  ssh "$VPS_USER@$VPS_HOST" "cd $VPS_PATH && bash scripts/upgrade-postgres-16-to-18.sh ${RESUME_ARG}$LGTM_F"
elif [[ "$DO_BUILD" == true ]]; then
  # Po sync: bind mount nginx.conf moze wskazywac stary inode — wymus odswiezenie
  # shellcheck disable=SC2029
  ssh "$VPS_USER@$VPS_HOST" "cd $VPS_PATH && $REMOTE_PREP && docker compose \$COMPOSE_FILES build && docker compose \$COMPOSE_FILES up -d && (docker compose \$COMPOSE_FILES up -d --no-deps --force-recreate nginx 2>/dev/null || true)"
else
  # shellcheck disable=SC2029
  ssh "$VPS_USER@$VPS_HOST" "cd $VPS_PATH && $REMOTE_PREP && docker compose \$COMPOSE_FILES up -d && (docker compose \$COMPOSE_FILES up -d --no-deps --force-recreate nginx 2>/dev/null || true)"
fi

echo ""
echo "Done. Check: https://dyskiof.net"
