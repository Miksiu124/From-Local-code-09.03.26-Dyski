# Dyskiof.net — Premium Content Platform

> **Dyskiof.net** — full-featured premium content platform running on VPS. Credits, HLS streaming, admin panel, payments (BLIK, Crypto, PayPal, Revolut), referral system, promo codes, and custom tracking links. Built with **Next.js 16**, **Go (Echo)**, **PostgreSQL**, **Redis**, and **Cloudflare R2**.

[![Dyskiof.net](https://img.shields.io/badge/Dyskiof.net-VPS%20Ready-success)](https://dyskiof.net)

> **Deploy:** See [DEPLOY.md](DEPLOY.md) for full VPS deployment instructions. Quick deploy: `./scripts/deploy-vps.sh --build` (kod na VPS z GitHub: `--pull --build` / PowerShell `-Pull -Build`). Wolumin produkcyjny Postgresa i LGTM: ta sama reguła w `scripts/compose-vps-files.sh` (stosuje ją m.in. `vps-rebuild.sh` i `deploy-vps` po stronie serwera).

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4 |
| Backend API | Go 1.24, Echo framework |
| Database | PostgreSQL 18 |
| Cache / PubSub | Redis 7 |
| Object Storage | Cloudflare R2 (S3-compatible) |
| Video Streaming | HLS with token-secured segments |
| Bot Protection | Cloudflare Turnstile (CAPTCHA on registration) |
| Email | [Resend](https://resend.com) (HTTPS API); optional SMTP for local dev — `docs/EMAIL_VPS_SETUP.md` |
| Proxy | Nginx 1.28 (reverse proxy, rate limiting, Cloudflare IP trust) |
| Containerization | Docker and Docker Compose |
| i18n | next-intl (English, Polish) |
| Auth | JWT + cookie sessions, email verification |
| Currency | PLN base with automatic USD conversion (4 PLN = 1 USD) |

---

## Features

### User-facing
- Browse models with filtering (video/photo) and sorting
- HLS video player with keyboard navigation, mobile seek zones, quality selection
- Photo viewer with prev/next navigation and swipe support
- Credit-based purchasing (7 / 14 / 30 day access)
- Multiple payment methods: BLIK, Crypto (BTC, ETH, LTC, USDC), PayPal, Revolut
- Real-time payment status updates (SSE + WebSocket for BLIK)
- Payment proof upload (JPEG, PNG, WebP, GIF, PDF) with inline admin review
- Promo codes (percent discount or bonus credits)
- Referral program (earn credits when referred users make purchases)
- Email verification (required for purchases and content streaming)
- Favorites system with dedicated content viewer
- User dashboard with credit balance, purchases, notifications, and email verification status
- Currency converter (PLN/USD) on purchase page
- Responsive, dark-themed UI with animations

### Video Player
- iOS native fullscreen with play-before-fullscreen workaround
- Android container-based fullscreen (reliable across browsers)
- Mobile seek zones: tap left 25% for -10s, tap right 75% for +10s, center for play/pause
- Touch-friendly progress bar (taller on mobile)
- Quality selector rendered via portal (no overflow clipping in fullscreen)
- Fullscreen in-place navigation (prev/next without exiting fullscreen on Android)
- Swipe navigation with velocity detection

### Admin panel
- Real-time payment approval queue (SSE + polling) with inline payment proof viewer
- User management (ban, credit adjustments, access grants, email verification filter)
- Model management (R2 import, country assignment, featured toggle)
- Credit package management (create/edit/delete, prices in PLN)
- Promo codes management (create/edit/delete, percent or fixed credits, per-user limits, first-purchase-only, expiration)
- Custom tracking links with visit analytics and conversion tracking
- Platform settings (crypto wallets, BLIK/crypto expiration, bundle costs, referral settings)
- Analytics dashboard (revenue, users, top sellers)
- R2 bucket sync and import tools

### Security
- JWT authentication with HTTP-only cookies
- Email verification enforcement (purchases and streaming blocked for unverified users)
- Cloudflare Turnstile bot protection on registration
- Rate limiting (Redis-based + Nginx zones with Cloudflare IP trust)
- CSRF protection middleware
- CSP, HSTS, Permissions-Policy, and other security headers
- Token-secured HLS streaming (prevents direct video access)
- Admin role enforcement
- User banning
- IP extraction via CF-Connecting-IP (Nginx forwards real client IP)
- Outbound email: Resend API or optional SMTP, with retry and exponential backoff (4 attempts)
- Security email notifications on password and email changes
- API data minimization (only essential fields returned)
- Log sanitization (no PII or tokens in logs)
- Nginx pinned to 1.28+ (CVE-2025-23419 fix)

---

## Project Structure

```
├── backend/                    # Go API server
│   ├── cmd/server/main.go      # Entry point and route registration
│   ├── cmd/seed/main.go        # Database seeder
│   ├── internal/               # Domain packages
│   │   ├── admin/              # Admin endpoints + promo codes + custom links
│   │   ├── auth/               # Auth (register/login/JWT/email verification)
│   │   ├── common/             # Shared utilities (currency, errors)
│   │   ├── content/            # Content streaming, R2 client
│   │   ├── credits/            # Credit purchases, BLIK WS, promo validation
│   │   ├── discord/            # Discord webhook notifications
│   │   ├── favorites/          # Favorites with content viewer details
│   │   ├── geo/                # Geo/country endpoints
│   │   ├── links/              # Custom tracking link resolution
│   │   ├── models/             # Model browsing
│   │   ├── purchases/          # Model access purchases
│   │   ├── referral/           # Referral system
│   │   ├── notifications/      # Notifications
│   │   ├── mailer/             # Resend API or SMTP + templates
│   │   ├── middleware/         # Auth, admin, email verification
│   │   └── jobs/              # Cron jobs (R2 sync)
│   ├── migrations/             # SQL migrations (auto-run on init)
│   ├── Dockerfile
│   └── .env.example
│
├── src/                        # Next.js frontend
│   ├── app/
│   │   ├── (auth)/             # /login, /register, /verify-email, /forgot-password, /reset-password
│   │   ├── (user)/             # /models, /content, /purchase, /dashboard, /favorites, /referral, /my-purchases
│   │   ├── (admin)/admin/      # /admin/* (payments, packages, promo-codes, custom-links, models, users, analytics, settings)
│   │   └── l/[slug]/           # Custom link redirect route
│   ├── components/             # React components
│   │   ├── admin/              # Admin sidebar, payments list
│   │   ├── layout/             # Header, footer, notification bell
│   │   ├── payments/           # Credit purchase flow, currency converter
│   │   ├── ui/                 # Button, card, input, retry-image, etc.
│   │   └── user/               # Model detail, models grid, video player, content viewer, favorites, referral panel
│   ├── lib/                    # Utilities, API client, rate limiting
│   └── messages/               # i18n (en.json, pl.json)
│
├── prisma/
│   ├── schema.prisma           # Database schema (users, models, content, credits, promo codes, referrals, custom links, etc.)
│   └── seed.ts                 # Seed script (packages in PLN, settings, countries)
│
├── nginx/
│   ├── nginx.conf              # Dev reverse proxy config
│   └── nginx.conf.production   # Production config (SSL, Cloudflare IP trust, rate limiting)
│
├── scripts/                    # Deploy and utility scripts
│   ├── deploy-vps.sh           # Deploy: rsync lub --pull (git na VPS) + docker compose
│   ├── deploy-vps.ps1          # PowerShell (rsync/tar lub -Pull + docker)
│   ├── vps-fresh-install.sh    # Fresh VPS install
│   ├── vps-rebuild-fresh.sh    # Full rebuild preserving users
│   └── ...                     # Load testing, DNS, env generation scripts
│
├── docs/                       # Documentation
│   ├── SECURITY_AUDIT.md
│   ├── NGINX_SECURITY_AUDIT.md
│   ├── MIGRATION_NEW_VPS_2026.md
│   └── ...
│
├── .github/                    # CI/CD
│   └── workflows/              # Tests, DAST, CodeQL
│
├── docker-compose.yml          # All services (lokalnie: nginx → nginx.conf)
├── docker-compose.vps.yml      # VPS: wymusza nginx.conf.production (łącz z -f przy deploy)
├── Dockerfile.frontend         # Next.js container (with Turnstile build-arg)
├── next.config.ts              # CSP headers, Turnstile domain allowlisting
├── package.json
└── tsconfig.json
```

---

## Prerequisites

- **Docker** and **Docker Compose** (v2)
- **Cloudflare R2** bucket with content uploaded
- (Optional) **Cloudflare Turnstile** site key + secret key for bot protection
- (Optional) **Node.js 20+** for local frontend dev
- (Optional) **Go 1.24+** for local backend dev

---

## Quick Start (Docker)

### 1. Clone the repository

```bash
git clone https://github.com/Miksiu124/From-Local-code-09.03.26-Dyski.git
cd From-Local-code-09.03.26-Dyski
```

### 2. Create the .env file

Copy the example and fill in your values:

```bash
cp .env.example .env
```

Edit `.env` with your actual credentials:

```env
# Database
POSTGRES_PASSWORD=your_strong_db_password
DATABASE_URL=postgresql://platform:your_strong_db_password@postgres:5432/content_platform?sslmode=disable

# Redis
REDIS_URL=redis://redis:6379

# JWT (generate with: openssl rand -hex 32)
JWT_SECRET=your_random_64_char_string
JWT_EXPIRY_SECS=2592000

# Cloudflare R2
R2_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY_ID=your_key
R2_SECRET_ACCESS_KEY=your_secret
R2_BUCKET_NAME=your_bucket
R2_ENDPOINT=https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com

# HLS streaming token (generate with: openssl rand -hex 32)
STREAMING_TOKEN_SECRET=another_random_64_char_string
STREAMING_TOKEN_TTL=21600

# Admin (comma-separated emails that get ADMIN role on register)
ADMIN_EMAILS=your_email@example.com

# BLIK
BLIK_EXPIRATION_MINUTES=2

# Cloudflare Turnstile (optional, bot protection on registration)
TURNSTILE_SECRET_KEY=your_turnstile_secret
NEXT_PUBLIC_TURNSTILE_SITE_KEY=your_turnstile_site_key

# E-mail (produkcja: Resend — patrz docs/EMAIL_VPS_SETUP.md)
RESEND_API_KEY=
SMTP_FROM=noreply@dyskiof.net
# Opcjonalnie: MARKETING_EMAIL_FROM= dla kampanii (wbudowane szablony)

# Frontend (used by docker-compose)
NEXT_PUBLIC_APP_URL=http://localhost
```

### 3. Start all services

```bash
docker compose up -d --build
```

This starts 5 containers:

| Service | Port | Description |
|---|---|---|
| nginx | **80, 443** | Reverse proxy (main entry point) |
| frontend | 3000 (localhost only) | Next.js SSR |
| api | 8080 (localhost only) | Go API |
| postgres | 5432 (localhost only) | Database |
| redis | 6379 (localhost only) | Cache and PubSub |

### 4. Seed the database

```bash
docker compose exec frontend npx prisma db push
docker compose exec frontend npx tsx prisma/seed.ts
```

This creates:
- Default admin user: `admin@contentvault.com` / `admin123`
- 4 credit packages: Starter (20 PLN), Popular (40 PLN), Pro (100 PLN), Ultimate (200 PLN)
- 21 countries
- Default platform settings (crypto wallets, expiration times, referral config)

### 5. Import content from R2

1. Open `http://localhost/admin` and log in with the admin account
2. Go to the **Models** tab
3. Click **Sync R2** to discover models from your R2 bucket
4. Click **Import** next to each model to import content items

### 6. Access the platform

| URL | Description |
|---|---|
| `http://localhost` | Main site |
| `http://localhost/login` | Login page |
| `http://localhost/register` | Registration (with Turnstile if configured) |
| `http://localhost/admin` | Admin panel |

---

## Deploy na VPS

The repository includes deploy scripts. See **[DEPLOY.md](DEPLOY.md)** for full structure and VPS deployment guide.

```bash
# Quick deploy (rsync + docker compose on VPS)
./scripts/deploy-vps.sh --build
```

Set `VPS_HOST`, `VPS_USER` in `.env.deploy`; na produkcji z wolumenem `contentvault_postgres_cluster` ustaw też **`VPS_USE_POSTGRES_CLUSTER=1`** (włącza `docker-compose.use3566349.yml`). Skrypty deploy dokładają **`docker-compose.vps.yml`** (produkcyjny nginx). Details in `DEPLOY.md`, `docs/SECURITY_AUDIT.md`.

---

## R2 Bucket Structure

The platform expects content in your R2 bucket organized like this:

```
your-bucket/
├── model-folder-name/
│   ├── thumbnails/
│   │   ├── video1.jpg
│   │   └── photo1.jpg
│   ├── hls/
│   │   └── video1/
│   │       ├── master.m3u8
│   │       └── 720p/
│   │           ├── playlist.m3u8
│   │           └── segment-*.ts
│   └── photos/
│       └── photo1.jpg
├── another-model/
│   └── ...
```

The R2 sync job runs automatically every hour and on API startup.

---

## Payment Methods

| Method | Flow |
|---|---|
| BLIK | User enters 6-digit code. Admin sees it in real-time. Admin approves/rejects. User gets instant notification. |
| Crypto (BTC, ETH, LTC, USDC) | User selects crypto. Gets wallet address + blockchain network. Sends payment. Submits TxID. Admin verifies and approves. |
| PayPal | User creates purchase. Sends payment manually. Admin approves. |
| Revolut | User creates purchase. Sends payment manually. Admin approves. |

All payment methods support:
- Configurable expiration times (BLIK in minutes, crypto/PayPal/Revolut in hours)
- Payment proof upload (JPEG, PNG, WebP, GIF, PDF with magic byte validation)
- Admin inline proof viewer (images and PDFs)
- Admin notes
- Discord webhook notifications
- Promo code discounts

Prices are stored in PLN. For English locale, prices are converted to USD at 4:1 rate (rounded up).

---

## Environment Variables Reference

| Variable | Required | Description |
|---|---|---|
| `POSTGRES_PASSWORD` | Yes | PostgreSQL password |
| `DATABASE_URL` | Yes | Full PostgreSQL connection string |
| `REDIS_URL` | Yes | Redis connection string |
| `JWT_SECRET` | Yes | Secret for JWT token signing |
| `JWT_EXPIRY_SECS` | No | Token expiry (default: 2592000 = 30 days) |
| `R2_ACCOUNT_ID` | Yes | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | Yes | R2 API key ID |
| `R2_SECRET_ACCESS_KEY` | Yes | R2 API secret |
| `R2_BUCKET_NAME` | Yes | R2 bucket name |
| `R2_ENDPOINT` | Yes | R2 endpoint URL |
| `STREAMING_TOKEN_SECRET` | Yes | Secret for HLS token signing |
| `STREAMING_TOKEN_TTL` | No | HLS token TTL in seconds (default: 21600) |
| `ADMIN_EMAILS` | Yes | Comma-separated admin emails |
| `BLIK_EXPIRATION_MINUTES` | No | BLIK code expiry (default: 2) |
| `TURNSTILE_SECRET_KEY` | No | Cloudflare Turnstile secret key (bot protection) |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | No | Cloudflare Turnstile site key (frontend widget) |
| `RESEND_API_KEY` | No* | Klucz API Resend (wysyłka HTTPS); razem z `SMTP_FROM` |
| `SMTP_FROM` | No* | Adres nadawcy — domena zweryfikowana w Resend |
| `MARKETING_EMAIL_FROM` | No | Opcjonalny nadawca kampanii marketingowych (wbudowane szablony); puste = `SMTP_FROM` |
| `SMTP_HOST` | No | Opcjonalnie: zewnętrzny SMTP zamiast Resend (np. Mailpit); **`RESEND_API_KEY` pusty** |
| `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` | No | Tylko przy `SMTP_HOST` |

\* Na produkcji ustaw `RESEND_API_KEY` i `SMTP_FROM`, albo sam `SMTP_HOST` (bez Resend).

| `NGINX_CONFIG` | No | Opcjonalnie: inna ścieżka nginx **tylko lokalnie**. Na VPS użyj **`docker-compose.vps.yml`** zamiast zmiennej w `.env`. |
| `FRONTEND_URL` | No | Frontend URL (default: http://localhost:3000) |
| `NEXT_PUBLIC_APP_URL` | No | Public app URL |
| `DISCORD_CLIENT_ID` | No | Discord OAuth client ID |
| `DISCORD_CLIENT_SECRET` | No | Discord OAuth client secret |
| `DISCORD_REDIRECT_URI` | No | Discord OAuth redirect URI |

---

## Development (Local)

### Frontend only

```bash
npm install
npx prisma generate
npm run dev
```

Requires the Go API and database running (via Docker or locally).

### Backend only

```bash
cd backend
cp .env.example ../.env   # edit with your values
go run ./cmd/server
```

### Database commands

```bash
npm run db:generate    # Generate Prisma client
npm run db:push        # Push schema to database
npm run db:migrate     # Run migrations
npm run db:seed        # Seed default data
npm run db:studio      # Open Prisma Studio GUI
```

**Pending migrations (existing DB):** If the DB was created before new migrations were added, run:
```bash
./scripts/run-pending-migrations.sh   # Creates referral_link_visits etc.
# Or on Windows:
.\scripts\run-pending-migrations.ps1
```

---

## Tests

Tests run automatically on push and pull requests via GitHub Actions (workflow **Tests**, plus **CodeQL** on PRs/branches configured in `codeql.yml`). **DAST** is manual/cron-only.

To ensure nothing reaches `main` until CI is green—and so **Deploy (VPS rolling)** runs after **`Tests`** succeeds on pushes to **`main`**—enable branch protection:

1. Repo **Settings → Rules → Rulesets** (or **Branches → Branch protection**) for **`main`**.
2. Require status checks **before merge**: enable **GitHub Actions** and select the **`Tests`** workflow jobs you care about (e.g. `Go Backend`, `Frontend`, `No secrets in repo`). Optionally require **CodeQL** matrix jobs (`Analyze (go)`, `Analyze (javascript-typescript)`).
3. Prefer **Require branches to be up to date before merging** so merges are tested against the latest `main`.

```bash
# Backend (Go)
cd backend && go test -v ./...

# Frontend (Vitest)
npm run test

# Lint
npm run lint
```

---

## Useful Commands

```bash
# View logs
docker compose logs -f api
docker compose logs -f frontend
docker compose logs -f nginx

# Restart a single service
docker compose restart api
docker compose restart frontend

# Rebuild and restart
docker compose up -d --build frontend api

# Stop everything
docker compose down

# Stop and remove volumes (DELETES ALL DATA)
docker compose down -v
```

---

## API Overview

The Go backend exposes a RESTful API at `/api/`. Key endpoint groups:

- **Auth** `/api/auth/*` — register, login, logout, me, verify-email, resend-verification, forgot/reset-password, Discord OAuth
- **Models** `/api/models/*` — browse models, content lists, public settings
- **Content** `/api/content/*` — thumbnails, HLS playlists/segments, content details
- **Credits** `/api/credits/*` — purchase flow, status, BLIK, promo code validation
- **Purchases** `/api/purchases` — buy model access with credits
- **Favorites** `/api/favorites` — toggle/list/check, content details for favorites viewer
- **Referral** `/api/referral/me` — referral stats and link
- **Notifications** `/api/notifications` — list/mark read, SSE stream
- **Links** `/api/public/links/:slug` — custom link redirect with tracking
- **Admin** `/api/admin/*` — full admin CRUD (users, models, packages, promo codes, custom links, settings, analytics)

All authenticated endpoints require the `session_token` cookie (set on login). Purchases and streaming require email verification.

---

## License

Private / All Rights Reserved.
