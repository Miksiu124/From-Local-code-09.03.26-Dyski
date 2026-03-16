# Database Optimization — March 2026

Optimizations applied for faster content serving and more reliable caching.

## Production safety (no data loss)

- **Additive only**: Migration creates indexes only. No `DROP TABLE`, `TRUNCATE`, `DELETE`, or `UPDATE` of user/client data.
- **Client data preserved**: Users, purchases, credit_purchases, user_access, favorites, and all business data are untouched.
- **Rollback safe**: Down migration drops indexes only; no data is removed.

## 1. PostgreSQL Indexes

**Migration:** `backend/migrations/20260316120000_content_serving_optimizations.up.sql`

| Index | Purpose |
|-------|---------|
| `idx_content_items_model_created` | GetBySlug / ListContent `ORDER BY created_at` |
| `idx_content_items_model_duration` | ListContent `ORDER BY duration` (longest/shortest) |
| `idx_models_active_name_id` | Models List cursor pagination `ORDER BY name, id` |

**Apply on existing DB:**
```bash
docker compose exec -T postgres psql -U platform -d content_platform < backend/migrations/20260316120000_content_serving_optimizations.up.sql
```

## 2. Redis Caching

| Endpoint | Cache Key | TTL |
|----------|-----------|-----|
| `GET /api/models` (first page, no filters) | `api:models:first` / `api:models:featured` | 3 min |
| `GET /api/models/:slug` | `api:model:slug:{slug}` | 5 min |
| `GET /api/models/:slug/content` (first page) | `api:model:content:{slug}:{type}:{sort}:first` | 3 min |

**Invalidation:** Automatic on admin SyncR2, ImportR2, ToggleContentHidden, DeleteContent.

## 3. Postgres Tuning (docker-compose)

- `random_page_cost=1.1` — SSD-optimized (default 4.0 for HDD)
- `effective_io_concurrency=200` — SSD parallel I/O

## 4. Redis Tuning

- `lazyfree-lazy-eviction yes` — Non-blocking eviction under memory pressure
- `lazyfree-lazy-server-del yes` — Non-blocking DEL

## 5. Connection Pool (unchanged)

- Postgres: max 20, min 2, 30min lifetime
- Redis: pool 10, min idle 2
