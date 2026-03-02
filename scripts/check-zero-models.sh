#!/bin/bash
cd /opt/contentvault
source .env
docker compose exec -T postgres psql -U platform -d content_platform -t -c "
SELECT m.folder_name, COUNT(ci.id) 
FROM models m 
LEFT JOIN content_items ci ON ci.model_id = m.id 
GROUP BY m.id, m.folder_name 
HAVING COUNT(ci.id) = 0 
ORDER BY m.folder_name 
LIMIT 50;
"
