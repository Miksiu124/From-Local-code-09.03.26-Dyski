# Backend Modules — Go

> Struktura: `backend/internal/<module>/`
> Entry point: `backend/cmd/server/main.go`

## Modules

### `config/`
Ładowanie konfiguracji z envs: `config.Load()` → struct z polami:
- Server: PORT, ENVIRONMENT, FRONTEND_URL
- DB: DATABASE_URL
- Redis: REDIS_URL
- JWT: JWT_SECRET, JWT_EXPIRY_SECS
- R2: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_ENDPOINT
- Streaming: STREAMING_TOKEN_SECRET, STREAMING_TOKEN_TTL
- Admin: ADMIN_EMAILS (lista emaili admina)

### `database/`
- `postgres.go` — `NewPostgresPool()` → `*pgxpool.Pool`
- `redis.go` — `NewRedisClient()` → `*redis.Client`

### `auth/`
- `service.go` — `Register`, `Login`, `Logout`, `Me`
- `handler.go` — Echo handlers
- `models.go` — Request/response structs
- JWT token generation & validation
- Password hashing (bcrypt via golang.org/x/crypto)

### `middleware/`
- `cors.go` — CORS config (FrontendURL based)
- `auth.go` — `Authenticate` (wymaga session), `OptionalAuth` (opcjonalnie)
- `admin.go` — `RequireAdmin` (sprawdza ADMIN_EMAILS)
- `rate_limiter.go` — Redis-based rate limiting
- `request_id.go` — Request ID middleware
- `context.go` — Context helpers (get user from context)

### `models/`
- `handler.go` — List, GetBySlug, ListContent, GetStats, ListCountries, GetPublicSettings, CheckAccess, GetUserAccess
- `queries.go` — Raw SQL queries for models
- `types.go` — Structs

### `content/`
- `handler.go` — Thumbnail, Playlist, Segment, ModelAvatar, ModelHeader, GetContentDetails
- `service.go` — `RunFullSync()` — synchronizacja R2 → DB
- `r2.go` — R2Client (S3 compatible, signed URLs)
- `streaming.go` — HLS token signing/validation
- `sync.go` — Logika sync
- `types.go` — Content-related structs

### `credits/`
- `handler.go` — CreatePurchase, UploadProof, GetPurchaseStatus, StreamPurchaseStatus, SubmitTxId, UpdateBlikCode, ListPurchases, ListPackages, BlikWebSocket
- `queries.go` — SQL queries
- `types.go` — Structs
- `websocket.go` — BLIK WebSocket

### `purchases/`
- `handler.go` — Create (buy access), List

### `favorites/`
- `handler.go` — Toggle, List, BatchCheck

### `notifications/`
- `handler.go` — List, MarkAllRead

### `user/`
- `handler.go` — GetBalance

### `admin/`
- `handler.go` — Duży handler z wieloma metodami (users, packages, models, settings, analytics, R2 sync)
- `types.go` — Admin-specific structs

### `jobs/`
- `scheduler.go` — Cron scheduler (robfig/cron) — odpala `RunFullSync()` co godzinę

### `common/`
- Shared utilities

### `discord/`
- Discord integration placeholders
