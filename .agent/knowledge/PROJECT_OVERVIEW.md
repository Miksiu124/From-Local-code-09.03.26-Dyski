# ContentVault — Project Overview

> **Platforma premium content** (zdjęcia i filmy) z systemem kredytów, płatności (BLIK, crypto, PayPal, Revolut), HLS streamingiem i panelem admina.

## Tech Stack

| Warstwa | Technologia | Wersja |
|---|---|---|
| **Frontend** | Next.js (App Router) + React + TypeScript | Next 16.1, React 19.2 |
| **Styling** | Tailwind CSS + `class-variance-authority` | Tailwind 4 |
| **Font** | Google Fonts — Outfit | — |
| **Auth** | NextAuth (beta 30) + Prisma Adapter | next-auth 5.0.0-beta.30 |
| **ORM (frontend)** | Prisma Client | 6.19 |
| **Backend API** | Go (Echo framework) | Go 1.24, Echo 4.15 |
| **Database** | PostgreSQL 16 (Alpine) | — |
| **Cache/Rate limit** | Redis 7 (Alpine) | — |
| **Storage** | Cloudflare R2 (S3-compatible) | — |
| **Video** | HLS streaming (hls.js) | 1.6 |
| **i18n** | next-intl (EN + PL) | 4.8 |
| **Monitoring** | Sentry | @sentry/nextjs 10.38 |
| **Animations** | Framer Motion | 12.33 |
| **Proxy** | Nginx (Alpine) + Cloudflare | — |
| **Deployment** | Docker Compose (5 serwisów) | — |
| **Domena** | dyskiofleaks.com | — |

## Struktura katalogów (top-level)

```
/
├── backend/           ← Go API (Echo)
│   ├── cmd/server/    ← main.go (entry point)
│   ├── internal/      ← domain packages (15 modułów)
│   └── migrations/    ← SQL migrations (15 plików)
├── src/               ← Next.js frontend
│   ├── app/           ← App Router (strony)
│   ├── components/    ← React components
│   ├── lib/           ← Utilities, API client, auth
│   ├── i18n/          ← Konfiguracja next-intl
│   └── messages/      ← en.json, pl.json
├── prisma/            ← schema.prisma + seed.ts
├── nginx/             ← nginx.conf
├── scripts/           ← test scripts (auth, admin, payment, deployment)
├── docker-compose.yml ← 5 serwisów
├── Dockerfile.frontend
├── .env               ← zmienne środowiskowe
└── next.config.ts     ← rewrites /api/* → Go backend
```

## Klucze i porty

| Serwis | Port | Container |
|---|---|---|
| Frontend (Next.js) | 3000 | content-frontend |
| Backend API (Go) | 8080 | content-api |
| PostgreSQL | 5432 (localhost only) | content-postgres |
| Redis | 6379 (localhost only) | content-redis |
| Nginx | 80 / 443 | content-nginx |

## Admin access

- Email admina: `dyskiof@proton.me` (ustawione w `ADMIN_EMAILS` w `.env`)
- Admin role jest przydzielana w Go backend na podstawie listy w env

## Komendy startowe

```bash
# Development (bez Dockera)
npm run dev          # Frontend na :3000
cd backend && go run cmd/server/main.go  # Backend na :8080

# Docker (pełny stack)
docker-compose up -d --build
docker-compose logs -f

# Baza danych
npm run db:generate  # Generuj Prisma Client
npm run db:push      # Push schema do DB
npm run db:seed      # Seed bazy (kraje, pakiety)
npm run db:studio    # Prisma Studio GUI
```
