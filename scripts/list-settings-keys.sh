#!/bin/bash
cd /opt/contentvault
docker compose exec -T postgres psql -U platform -d content_platform -t -c "SELECT key FROM settings ORDER BY key;"
