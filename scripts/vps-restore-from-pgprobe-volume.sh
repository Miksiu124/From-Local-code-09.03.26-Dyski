#!/usr/bin/env bash
# Jednorazowy restore: dane z pgprobe_27920 (stary layout .../data/) -> główny content-postgres.
# Uruchom na VPS: cd /opt/contentvault && bash scripts/vps-restore-from-pgprobe-volume.sh
set -euo pipefail
cd /opt/contentvault
COMPOSE=( -f docker-compose.yml -f docker-compose.vps.yml )
PW="$(grep -E '^POSTGRES_PASSWORD=' .env | cut -d= -f2- | tr -d '\r\n"' | head -1)"
export PGPASSWORD="$PW"

DATA_PATH="/var/lib/docker/volumes/pgprobe_27920/_data/data"
echo "=== Tymczasowy Postgres (entrypoint) na $DATA_PATH ==="
docker rm -f pgold 2>/dev/null || true
docker run -d --name pgold --entrypoint /usr/local/bin/postgres -u postgres \
  -v "$DATA_PATH:/var/lib/postgresql/data" \
  -p 127.0.0.1:55433:5432 \
  postgres:18-alpine \
  -D /var/lib/postgresql/data -c listen_addresses='*'
for i in $(seq 1 30); do
  docker exec pgold pg_isready -U platform -d content_platform -q 2>/dev/null && break
  sleep 1
done

echo "=== pg_dump ze źródła ==="
docker exec -e PGPASSWORD="$PW" pgold pg_dump -U platform -h 127.0.0.1 -p 5432 content_platform -Fc -f /tmp/from_pgprobe.dump
docker cp pgold:/tmp/from_pgprobe.dump /tmp/from_pgprobe.dump
ls -lh /tmp/from_pgprobe.dump

echo "=== Stop api/frontend, restore ==="
docker compose "${COMPOSE[@]}" stop api frontend
docker cp /tmp/from_pgprobe.dump content-postgres:/tmp/restore.dump
set +e
docker compose "${COMPOSE[@]}" exec -T postgres pg_restore -U platform -d content_platform --clean --if-exists --no-owner --no-acl /tmp/restore.dump
RV=$?
set -e
echo "pg_restore exit: $RV (1 = drobne ostrzeżenia — OK)"

docker compose "${COMPOSE[@]}" exec -T postgres rm -f /tmp/restore.dump
rm -f /tmp/from_pgprobe.dump
docker rm -f pgold

echo "=== Start api/frontend ==="
docker compose "${COMPOSE[@]}" up -d api frontend

echo "=== Weryfikacja ==="
docker compose "${COMPOSE[@]}" exec -T postgres psql -U platform -d content_platform -c "SELECT count(*) AS models FROM models; SELECT count(*) AS content_items FROM content_items;"
echo "Gotowe."
