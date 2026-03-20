#!/bin/bash
# Dodaje zmienne R2 Proof Bucket do .env na VPS.
# Uruchom: R2_PROOF_ACCESS_KEY_ID=xxx R2_PROOF_SECRET_ACCESS_KEY=xxx R2_PROOF_BUCKET_NAME=files R2_PROOF_ENDPOINT=https://... bash scripts/vps-add-proof-env.sh
# Lub ustaw w .env.proof (nie commitowany) i: source .env.proof && bash scripts/vps-add-proof-env.sh
# Wymaga: .env.deploy z VPS_HOST, VPS_USER, VPS_PATH

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

if [ -f .env.deploy ]; then
  set -a
  source .env.deploy
  set +a
fi

if [ -f .env.proof ]; then
  set -a
  source .env.proof
  set +a
fi

VPS_USER="${VPS_USER:-marek}"
VPS_PATH="${VPS_PATH:-/opt/contentvault}"

if [ -z "$VPS_HOST" ]; then
  echo "Brak VPS_HOST. Ustaw w .env.deploy."
  exit 1
fi

if [ -z "$R2_PROOF_ACCESS_KEY_ID" ] || [ -z "$R2_PROOF_SECRET_ACCESS_KEY" ]; then
  echo "Ustaw R2_PROOF_ACCESS_KEY_ID, R2_PROOF_SECRET_ACCESS_KEY (oraz R2_PROOF_BUCKET_NAME, R2_PROOF_ENDPOINT)."
  exit 1
fi

R2_PROOF_BUCKET_NAME="${R2_PROOF_BUCKET_NAME:-files}"
R2_PROOF_ENDPOINT="${R2_PROOF_ENDPOINT:-}"

echo "=== Dodawanie R2 Proof env do $VPS_USER@$VPS_HOST:$VPS_PATH/.env ==="

ssh "${VPS_USER}@${VPS_HOST}" "cd $VPS_PATH && \
  (grep -v '^R2_PROOF_' .env 2>/dev/null || cat .env) > .env.tmp && \
  echo '' >> .env.tmp && \
  echo '# ── Payment Proof Bucket (R2) ────────────────────────────────' >> .env.tmp && \
  echo \"R2_PROOF_ACCESS_KEY_ID=$R2_PROOF_ACCESS_KEY_ID\" >> .env.tmp && \
  echo \"R2_PROOF_SECRET_ACCESS_KEY=$R2_PROOF_SECRET_ACCESS_KEY\" >> .env.tmp && \
  echo \"R2_PROOF_BUCKET_NAME=$R2_PROOF_BUCKET_NAME\" >> .env.tmp && \
  echo \"R2_PROOF_ENDPOINT=$R2_PROOF_ENDPOINT\" >> .env.tmp && \
  mv .env.tmp .env"

echo "Restartuję kontenery..."
ssh "${VPS_USER}@${VPS_HOST}" "cd $VPS_PATH && docker compose -f docker-compose.yml -f docker-compose.vps.yml up -d"

echo "R2 Proof env dodane. API i frontend zrestartowane."
