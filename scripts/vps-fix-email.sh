#!/bin/bash
# Dyskiof — dopisz / nadpisz RESEND_API_KEY w .env na VPS
# Uruchom NA VPS: cd /opt/contentvault && bash scripts/vps-fix-email.sh
# Lub: bash scripts/vps-fix-email.sh .env "$RESEND_API_KEY"

set -e

ENV_FILE="${1:-.env}"
RESEND_KEY="${2:-$RESEND_API_KEY}"

if [[ -z "$RESEND_KEY" ]]; then
  echo "Użycie: bash scripts/vps-fix-email.sh [.env] [RESEND_API_KEY]"
  echo "  lub:  export RESEND_API_KEY=re_... && bash scripts/vps-fix-email.sh"
  echo ""
  echo "Klucz: Resend → API Keys (Sending). SPF/DKIM: zweryfikuj domenę w Resend."
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Brak pliku $ENV_FILE"
  exit 1
fi

tmp="$(mktemp)"
grep -v '^RESEND_API_KEY=' "$ENV_FILE" > "$tmp"
mv "$tmp" "$ENV_FILE"

echo "RESEND_API_KEY=$RESEND_KEY" >> "$ENV_FILE"

if ! grep -q '^SMTP_FROM=' "$ENV_FILE" 2>/dev/null; then
  echo "SMTP_FROM=noreply@twojadomena.pl" >> "$ENV_FILE"
  echo "Dodano SMTP_FROM=noreply@twojadomena.pl (dostosuj domenę do Resend!)"
fi

echo "Zapisano RESEND_API_KEY w $ENV_FILE"
echo ""
echo "Zrestartuj API (ścieżka compose jak na VPS), np.:"
echo "  docker compose -f docker-compose.yml -f docker-compose.vps.yml restart content-api"
