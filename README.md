# ContentVault - Premium Content Platform

A full-stack premium content platform with credit-based payments, HLS video streaming, admin panel, and real-time payment notifications. Built with **Next.js 16**, **Go (Echo)**, **PostgreSQL**, **Redis**, and **Cloudflare R2**.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4 |
| Backend API | Go 1.24, Echo framework |
| Database | PostgreSQL 16 |
| Cache / PubSub | Redis 7 |
| Object Storage | Cloudflare R2 (S3-compatible) |
| Video Streaming | HLS with token-secured segments |
| SMTP | BillionMail / Postfix (self-hosted mail server) |
| Proxy | Nginx (reverse proxy, rate limiting, WAF) |
| Containerization | Docker and Docker Compose |
| i18n | next-intl (English, Polish) |
| Auth | JWT + cookie sessions |

---

## Features

### User-facing
- Browse models with filtering (video/photo) and sorting
- HLS video player with keyboard navigation
- Photo viewer with prev/next navigation
- Credit-based purchasing (7 / 14 / 30 day access)
- Multiple payment methods: BLIK, Crypto (BTC, ETH, USDT, USDC), PayPal, Revolut
- Real-time payment status updates (SSE + WebSocket for BLIK)
- Favorites system
- User dashboard with credit balance, purchases, and notifications
- Responsive, dark-themed UI with animations

### Admin panel
- Real-time payment approval queue (SSE + polling)
- User management (ban, credit adjustments, access grants)
- Model management (R2 import, country assignment, featured toggle)
- Credit package management (create/edit/delete)
- Platform settings (crypto wallets, costs, expiration times, BLIK toggle)
- Analytics dashboard (revenue, users, top sellers)
- R2 bucket sync and import tools

### Security
- JWT authentication with HTTP-only cookies
- Rate limiting (Redis-based + Nginx zones)
- CSRF protection middleware
- CSP, HSTS, and other security headers
- Token-secured HLS streaming (prevents direct video access)
- Admin role enforcement
- User banning
- WAF-style request blocking (Nginx)

---

## Project Structure

```
├── backend/                    # Go API server
│   ├── cmd/server/main.go      # Entry point and route registration
│   ├── cmd/seed/main.go        # Database seeder
│   ├── internal/               # Domain packages
│   │   ├── admin/              # Admin endpoints
│   │   ├── auth/               # Auth (register/login/JWT)
│   │   ├── content/            # Content streaming, R2 client
│   │   ├── credits/            # Credit purchases, BLIK WS
│   │   ├── favorites/          # Favorites
│   │   ├── models/             # Model browsing
│   │   ├── purchases/          # Model access purchases
│   │   ├── notifications/      # Notifications
│   │   ├── middleware/         # Auth, CORS, rate limiting
│   │   └── jobs/              # Cron jobs (R2 sync)
│   ├── migrations/             # SQL migrations (auto-run on init)
│   ├── Dockerfile
│   └── .env.example
│
├── src/                        # Next.js frontend
│   ├── app/
│   │   ├── (auth)/             # /login, /register
│   │   ├── (user)/             # /models, /content, /purchase, etc.
│   │   └── (admin)/admin/      # /admin/*
│   ├── components/             # React components
│   ├── lib/                    # Utilities, API client
│   └── messages/               # i18n (en.json, pl.json)
│
├── prisma/
│   ├── schema.prisma           # Database schema
│   └── seed.ts                 # Seed script
│
├── nginx/
│   └── nginx.conf              # Reverse proxy config
│
├── docker-compose.yml          # All services
├── Dockerfile.frontend         # Next.js container
├── next.config.ts
├── package.json
└── tsconfig.json
```

---

## Prerequisites

- **Docker** and **Docker Compose** (v2)
- **Cloudflare R2** bucket with content uploaded
- (Optional) **Node.js 20+** for local frontend dev
- (Optional) **Go 1.24+** for local backend dev

---

## Quick Start (Docker)

### 1. Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git
cd YOUR_REPO
```

### 2. Create the .env file

Copy the example and fill in your values:

```bash
cp backend/.env.example .env
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

# SMTP (BillionMail — self-hosted, no external provider needed)
SMTP_HOST=billionmail-postfix
SMTP_PORT=25
SMTP_FROM=noreply@yourdomain.com
BILLIONMAIL_HOSTNAME=mail.yourdomain.com

# Frontend (used by docker-compose)
NEXT_PUBLIC_APP_URL=http://localhost
```

### 3. Start all services

```bash
docker compose up -d --build
```

This starts 6 containers:

| Service | Port | Description |
|---|---|---|
| nginx | **80** | Reverse proxy (main entry point) |
| frontend | 3000 | Next.js SSR |
| api | 8080 | Go API |
| postgres | 5432 (localhost only) | Database |
| redis | 6379 (localhost only) | Cache and PubSub |
| billionmail-postfix | 25, 587 (localhost only) | Self-hosted SMTP ([BillionMail](https://github.com/Billionmail/BillionMail)) |

### 4. Seed the database

```bash
docker compose exec frontend npx prisma db push
docker compose exec frontend npx tsx prisma/seed.ts
```

This creates:
- Default admin user: `admin@contentvault.com` / `admin123`
- 4 credit packages (Starter, Popular, Pro, Ultimate)
- 21 countries
- Default platform settings

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
| `http://localhost/register` | Registration |
| `http://localhost/admin` | Admin panel |

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
| Crypto | User selects crypto. Gets wallet address. Sends payment. Submits TxID. Admin verifies and approves. |
| PayPal | User creates purchase. Sends payment manually. Admin approves. |
| Revolut | User creates purchase. Sends payment manually. Admin approves. |

All payment methods support:
- Configurable expiration times
- Payment proof upload (images)
- Admin notes
- Discord webhook notifications

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
| `SMTP_HOST` | No | SMTP server hostname (default: `billionmail-postfix`) |
| `SMTP_PORT` | No | SMTP port (default: `25`) |
| `SMTP_USER` | No | SMTP username (empty for local BillionMail relay) |
| `SMTP_PASSWORD` | No | SMTP password (empty for local BillionMail relay) |
| `SMTP_FROM` | No | Sender address (default: `noreply@contentvault.io`) |
| `BILLIONMAIL_HOSTNAME` | No | BillionMail mail hostname for DNS records |
| `FRONTEND_URL` | No | Frontend URL (default: http://localhost:3000) |
| `NEXT_PUBLIC_APP_URL` | No | Public app URL |

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

- **Auth** `/api/auth/*` - register, login, logout, me
- **Models** `/api/models/*` - browse models, content lists
- **Content** `/api/content/*` - thumbnails, HLS playlists/segments
- **Credits** `/api/credits/*` - purchase flow, status, BLIK
- **Purchases** `/api/purchases` - buy model access with credits
- **Favorites** `/api/favorites` - toggle/list/check
- **Notifications** `/api/notifications` - list/mark read
- **Admin** `/api/admin/*` - full admin CRUD + analytics

All authenticated endpoints require the `session_token` cookie (set on login).

---

## License

Private / All Rights Reserved.
