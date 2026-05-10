#!/usr/bin/env bash
# One-time VPS prep for GitHub Actions CD: install git, ensure scripts/, upload rollout helpers.
# Uses ContentManager/.env.deploy (same vars as scripts/deploy-vps.sh).
#
# Prerequisites: ssh + scp, key-based SSH to VPS, write access to VPS_PATH.
#
# Usage (from repo root → ContentManager):
#   bash scripts/bootstrap-vps-cd.sh

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

if [[ -f "$REPO_ROOT/.env.deploy" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$REPO_ROOT/.env.deploy"
  set +a
fi

VPS_USER="${VPS_USER:-root}"
VPS_HOST="${VPS_HOST:?Set VPS_HOST in .env.deploy or export VPS_HOST=}"
VPS_PATH="${VPS_PATH:-/opt/contentvault}"

TARGET="${VPS_USER}@${VPS_HOST}"

echo "=== Bootstrap VPS for CD → ${TARGET}:${VPS_PATH} ==="

ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new "$TARGET" bash -s -- "$VPS_PATH" <<'REMOTE'
set -euo pipefail
VPS_PATH="$1"
mkdir -p "$VPS_PATH/scripts"
if command -v git >/dev/null 2>&1; then
  echo "git: already installed ($(git --version))"
else
  echo "git: installing..."
  if command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq git
  elif command -v apk >/dev/null 2>&1; then
    apk add --no-cache git
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y git
  elif command -v yum >/dev/null 2>&1; then
    yum install -y git
  else
    echo "Could not detect package manager; install git manually." >&2
    exit 1
  fi
fi
git --version
REMOTE

scp -o BatchMode=yes -o StrictHostKeyChecking=accept-new \
  "$REPO_ROOT/scripts/rollout-on-vps.sh" \
  "$REPO_ROOT/scripts/compose-vps-files.sh" \
  "${TARGET}:${VPS_PATH}/scripts/"

ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new "$TARGET" \
  "chmod +x '$VPS_PATH/scripts/rollout-on-vps.sh' '$VPS_PATH/scripts/compose-vps-files.sh'"

echo "Scripts uploaded. Checking git repo at VPS_PATH..."
ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new "$TARGET" bash -s -- "$VPS_PATH" <<'REMOTE'
set -euo pipefail
VPS_PATH="$1"
cd "$VPS_PATH"
if [[ -d .git ]]; then
  echo "git: repo present — CD can use git pull on branch (e.g. main)."
  git remote -v 2>/dev/null | head -4 || true
  git status -sb 2>/dev/null | head -3 || true
else
  echo "WARN: no .git at $VPS_PATH — GitHub Actions rollout will fail at git fetch/pull until you either:"
  echo "  1) git clone <your-repo-url> into this path (backup .env first), or"
  echo "  2) git init && git remote add origin <url> && git fetch && git checkout -f main"
fi
REMOTE

echo "=== Done ==="
