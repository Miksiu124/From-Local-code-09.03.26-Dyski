# Deployment & DevOps

## Docker Compose — 5 serwisów

```yaml
services:
  api:          # Go backend (:8080), 512MB RAM, 1 CPU
  frontend:     # Next.js (:3000), 512MB RAM, 1 CPU  
  postgres:     # PostgreSQL 16 (:5432 local only), 1GB RAM
  redis:        # Redis 7 (:6379 local only), 320MB RAM
  nginx:        # Reverse proxy (:80/:443), 128MB RAM
```

### Sieć
- Wszystko w sieci `internal` (bridge)
- Nginx → frontend (:3000) + api (:8080)
- API → postgres + redis
- Frontend → api (wewnętrznie: `http://api:8080/api`)

### Volumes
- `postgres_data` — dane PostgreSQL
- `redis_data` — dane Redis
- `./uploads` → `/app/uploads` (api)
- `./nginx/nginx.conf` → `/etc/nginx/nginx.conf` (ro)
- `./nginx/certs` → SSL certs (ro)
- `./backend/migrations` → `/docker-entrypoint-initdb.d` (auto-migracje)

## Nginx Config

- Domena: `dyskiofleaks.com` + `www.dyskiofleaks.com`
- SSL: Let's Encrypt
- Cloudflare: Authenticated Origin Pulls (`ssl_verify_client on`)
- Security headers: HSTS, CSP, X-Frame-Options DENY, nosniff
- Stealth: domyślny serwer odrzuca SSL handshake (`ssl_reject_handshake on`)
- HTTP → HTTPS redirect

## Kluczowe zmienne .env

```bash
# Server
ENVIRONMENT=development|production
PORT=8080
FRONTEND_URL=http://localhost:3000

# Database
POSTGRES_PASSWORD=...
DATABASE_URL=postgresql://platform:...@localhost:5432/content_platform

# Redis  
REDIS_URL=redis://localhost:6379

# Auth
JWT_SECRET=...
AUTH_SECRET=...  # NextAuth
AUTH_URL=http://localhost:3000
ADMIN_EMAILS=dyskiof@proton.me

# R2 (Cloudflare)
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=files
R2_ENDPOINT=https://....r2.cloudflarestorage.com/

# HLS Streaming
STREAMING_TOKEN_SECRET=...
STREAMING_TOKEN_TTL=21600  # 6h

# Frontend
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

## Startup flow

1. `docker-compose up -d` → startuje postgres, redis, api, frontend, nginx
2. PostgreSQL automatycznie wykonuje migracje z `backend/migrations/`
3. Go API:
   - Łączy się z PostgreSQL i Redis
   - Uruchamia natychmiastowy R2 sync
   - Startuje scheduler (hourly R2 sync)
   - Nasłuchuje na :8080
4. Frontend (Next.js standalone) startuje na :3000
5. Nginx proxy'uje ruch z :80/:443

## Przydatne komendy

```bash
# Restart pojedynczego serwisu
docker-compose restart api
docker-compose restart frontend

# Rebuild
docker-compose build --no-cache frontend
docker-compose up -d frontend

# Logi
docker-compose logs -f api
docker-compose logs -f frontend

# Database
docker exec -it content-postgres psql -U platform -d content_platform

# Redis
docker exec -it content-redis redis-cli

# Health check
curl http://localhost:8080/health
curl -I http://localhost:3000
```

## Testing scripts

| Plik | Opis |
|---|---|
| `scripts/test-auth.js` | Test auth flow |
| `scripts/test-admin-features.js` | Test admin features |
| `scripts/test-payment-flow.ts` | Test payment flow |
| `scripts/validate-deployment.js` | Sprawdź deployment |
| `scripts/validate-deployment.ts` | Sprawdź deployment (TS) |
