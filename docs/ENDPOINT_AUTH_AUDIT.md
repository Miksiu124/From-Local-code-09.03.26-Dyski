# Endpoint auth audit (SECURITY_ARCHITECTURE_ACTION_PLAN)

Snapshot after implementation pass. **Rule:** every route must enforce session/role/resource as intended.

| Area | Pattern | Notes |
|------|---------|--------|
| `/api/auth/*` | Register/login/forgot/reset: public + **handler Redis limits**. `/me`, resend: `Authenticate`. | No change to handler limits. |
| Public catalog | `OptionalAuth` where needed (`/user/access`, `/models/:id/access`, content details/thumbnails). | Thumbnails stay preview-friendly; playlist/segment enforce access + token. |
| Credits `:id/*` | All queries use `user_id` in SQL (`WHERE id = $1 AND user_id = $2`). | **Fix:** `StreamPurchaseStatus` ticker poll now includes `user_id` (IDOR hardening). |
| Purchases / favorites / notifications / user | `Authenticate` on group or per-route. | User sees only own rows. |
| Admin `/api/admin/*` | `Authenticate` + `RequireAdmin`. | Full admin on users/content/settings. |
| BLIK WebSocket | `Authenticate` + ownership check in handler. | **Nginx:** path bypasses Next.js → Go (WS upgrade). |

## Rate limits (Redis, group)

| Group | Limit / window | Routes |
|-------|----------------|--------|
| public | 300 / 1 min | models, geo, countries, settings, links, referral track, avatars, credit-packages |
| content | 200 / 1 min | `/api/content/*` |
| credits | 30 / 1 min | `/api/credits/*` (incl. BLIK WS when matched on Go — see nginx) |
| user | 120 / 1 min | purchases, favorites, notifications, `/user/*`, `/referral/me` |
| admin | 100 / 1 min | `/api/admin/*` |

Disable with `DISABLE_API_RATE_LIMIT=true` (e.g. load testing).

## BFF (nginx)

- Default: `location /api/` → **frontend:3000**; Next `app/api/[[...path]]/route.ts` proxies to Go.
- Exception: `^/api/credits/purchase/<uuid>/blik$` → **api:8080** (WebSocket).
