#!/bin/bash
# Dyskiof — dopisz brakujące zmienne Cloudflare Email do .env na VPS
# Uruchom NA VPS: cd /opt/contentvault && bash scripts/vps-fix-email.sh
# Lub: bash scripts/vps-fix-email.sh .env "$CLOUDFLARE_EMAIL_ACCOUNT_ID" "$CLOUDFLARE_EMAIL_API_TOKEN"

set -e

ENV_FILE="${1:-.env}"
CF_ACCOUNT="${2:-$CLOUDFLARE_EMAIL_ACCOUNT_ID}"
CF_TOKEN="${3:-$CLOUDFLARE_EMAIL_API_TOKEN}"

if [[ -z "$CF_ACCOUNT" || -z "$CF_TOKEN" ]]; then
  echo "Użycie: bash scripts/vps-fix-email.sh [.env] [CLOUDFLARE_EMAIL_ACCOUNT_ID] [CLOUDFLARE_EMAIL_API_TOKEN]"
  echo "  lub:  export CLOUDFLARE_EMAIL_ACCOUNT_ID=... CLOUDFLARE_EMAIL_API_TOKEN=... && bash scripts/vps-fix-email.sh"
  echo ""
  echo "Token: Cloudflare Dashboard → Manage Account → API Tokens (Email Sending: Send)."
  echo "Account ID: prawy panel Overview."
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Brak pliku $ENV_FILE"
  exit 1
fi

tmp="$(mktemp)"
grep -v '^CLOUDFLARE_EMAIL_ACCOUNT_ID=' "$ENV_FILE" | grep -v '^CLOUDFLARE_EMAIL_API_TOKEN=' > "$tmp"
mv "$tmp" "$ENV_FILE"

{
  echo "CLOUDFLARE_EMAIL_ACCOUNT_ID=$CF_ACCOUNT"
  echo "CLOUDFLARE_EMAIL_API_TOKEN=$CF_TOKEN"
} >> "$ENV_FILE"

if ! grep -q '^SMTP_FROM=' "$ENV_FILE" 2>/dev/null; then
  echo "SMTP_FROM=noreply@twojadomena.pl" >> "$ENV_FILE"
  echo "Dodano SMTP_FROM=noreply@twojadomena.pl (dostosuj domenę!)"
fi

echo "Zapisano CLOUDFLARE_EMAIL_* w $ENV_FILE"
echo ""
echo "Zrestartuj API (ścieżka compose jak na VPS), np.:"
echo "  docker compose -f docker-compose.yml -f docker-compose.vps.yml restart content-api"
