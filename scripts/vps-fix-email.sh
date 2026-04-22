#!/bin/bash
# Dyskiof — dodaj brakujące zmienne SMTP do .env na VPS
# Uruchom NA VPS: cd /opt/contentvault && bash scripts/vps-fix-email.sh
# Przed: ustaw RESEND_API_KEY w env lub podaj jako arg: bash vps-fix-email.sh re_xxx

set -e

ENV_FILE="${1:-.env}"
API_KEY="${2:-$RESEND_API_KEY}"

if [[ -z "$API_KEY" ]]; then
  echo "Użycie: bash scripts/vps-fix-email.sh [.env] [RESEND_API_KEY]"
  echo "  lub:  export RESEND_API_KEY=re_xxx && bash scripts/vps-fix-email.sh"
  echo ""
  echo "Klucz Resend: resend.com → API Keys → Create API Key"
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Brak pliku $ENV_FILE"
  exit 1
fi

# Sprawdź czy już są ustawione
if grep -q '^SMTP_RELAY_PASSWORD=' "$ENV_FILE" 2>/dev/null; then
  RELAY_VAL=$(grep '^SMTP_RELAY_PASSWORD=' "$ENV_FILE" | cut -d= -f2)
  if [[ -n "$RELAY_VAL" && "$RELAY_VAL" != "re_"* ]]; then
    echo "SMTP_RELAY_PASSWORD już ustawiony w .env (niepusty)"
    exit 0
  fi
fi

# Dodaj lub zaktualizuj
for VAR in "SMTP_RELAYHOST=[smtp.resend.com]:587" "SMTP_RELAY_USERNAME=resend" "SMTP_RELAY_PASSWORD=$API_KEY"; do
  KEY="${VAR%%=*}"
  if grep -q "^${KEY}=" "$ENV_FILE" 2>/dev/null; then
    sed -i.bak "s|^${KEY}=.*|${VAR}|" "$ENV_FILE"
    echo "Zaktualizowano $KEY"
  else
    echo "Dodano $KEY"
    echo "$VAR" >> "$ENV_FILE"
  fi
done

# Usuń duplikat backupu jeśli sed go stworzył
rm -f "${ENV_FILE}.bak" 2>/dev/null || true

echo ""
echo "Zrestartuj kontenery: docker compose restart content-smtp content-api"
