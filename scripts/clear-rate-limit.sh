#!/bin/bash
# Clear rate limit for an IP address (Go backend Redis keys)
# Usage: ./scripts/clear-rate-limit.sh <IP>
# Run on VPS: cd /opt/contentvault && bash scripts/clear-rate-limit.sh 162.120.188.32

set -e
IP="${1:?Usage: $0 <IP_ADDRESS>}"

# Load .env for REDIS_PASSWORD if present
[[ -f .env ]] && set -a && . ./.env && set +a

# Keys used by Go backend (auth handler, referral handler)
KEYS=(
  "ratelimit:register:${IP}"
  "ratelimit:login-ip:${IP}"
  "ratelimit:forgot-password:${IP}"
  "ratelimit:reset-password:${IP}"
  "ratelimit:referral-track:${IP}"
)

REDIS_ARGS=()
[[ -n "$REDIS_PASSWORD" ]] && REDIS_ARGS=(-a "$REDIS_PASSWORD")

echo "Clearing rate limit for IP: $IP"
for key in "${KEYS[@]}"; do
  docker exec content-redis redis-cli "${REDIS_ARGS[@]}" DEL "$key" 2>/dev/null || true
  echo "  $key"
done
echo "Done. Rate limit cleared for $IP"
