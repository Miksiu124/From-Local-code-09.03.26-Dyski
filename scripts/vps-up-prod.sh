#!/usr/bin/env bash
# Na VPS: odpal cały stos z wolumenem klastrowym Postgresa (dane z credit_purchases itd.), nie pusty postgres_data.
# Użycie:  cd /opt/contentvault  &&  bash scripts/vps-up-prod.sh
# Opcjonalnie:  UP_PULL=1 bash scripts/vps-up-prod.sh  (docker compose pull przed up)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Opcja A: COMPOSE_FILE w .env (docker compose ładuje wszystkie pliki)
if ! grep -qE '^[[:space:]]*COMPOSE_FILE=' .env 2>/dev/null; then
  echo "Dopisuję COMPOSE_FILE do .env (JEDNORAZOWO)…"
  {
    echo ""
    echo "# Produkcja: wolumen contentvault_postgres_cluster — patrz docker-compose.use3566349.yml"
    echo "COMPOSE_FILE=docker-compose.yml:docker-compose.vps.yml:docker-compose.use3566349.yml:docker-compose.lgtm.yml"
  } >> .env
fi

EXTERNAL="contentvault_postgres_cluster"
if ! docker volume inspect "$EXTERNAL" &>/dev/null; then
  echo "Brak wolumenu $EXTERNAL — tworzę (pusty tylko przy PIERWSZYM ruchu, potem wypełniasz danymi z migracji/backupu)."
  docker volume create "$EXTERNAL"
fi

if [[ "${UP_PULL:-0}" == "1" ]]; then
  docker compose pull --ignore-pull-failures || true
fi

docker compose up -d --remove-orphans

echo "— postgres montuje:"
docker inspect -f '{{range .Mounts}}{{.Name}} -> {{.Destination}};{{end}}' content-postgres 2>/dev/null | tr ';' '\n' | head -3

echo "— szybka weryfikacja kasy (APPROVED):"
docker exec content-postgres psql -U platform -d content_platform -t -A -c "SELECT COALESCE(ROUND(SUM(amount::numeric),2),0) FROM credit_purchases WHERE status::text = 'APPROVED';"

echo "OK. Strona: https://dyskiof.net (albo domena z .env)."
