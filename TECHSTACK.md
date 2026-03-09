# Tech Stack — ContentVault

Kompletne zestawienie technologii wykorzystanych w projekcie ContentVault.

---

## Frontend

| Technologia | Wersja | Opis |
|-------------|--------|------|
| **Next.js** | 16.1.6 | Framework React z App Router |
| **React** | 19.2.4 | Biblioteka UI |
| **TypeScript** | 5.9.3 | Typowanie statyczne |
| **Tailwind CSS** | 4.1.18 | Framework CSS utility-first |
| **PostCSS** | 8.5.6 | Przetwarzanie CSS |
| **Framer Motion** | 12.33.0 | Animacje |
| **Lucide React** | 0.563.0 | Ikony |
| **next-intl** | 4.8.2 | Internacjonalizacja (EN, PL) |
| **hls.js** | 1.6.15 | Odtwarzacz HLS w przeglądarce |
| **class-variance-authority** | 0.7.1 | Zarządzanie wariantami komponentów |
| **tailwind-merge** | 3.4.0 | Łączenie klas Tailwind |
| **clsx** | 2.1.1 | Warunkowe klasy CSS |
| **Zod** | 4.3.6 | Walidacja schematów |

---

## Backend (API)

| Technologia | Wersja | Opis |
|-------------|--------|------|
| **Go** | 1.24 | Język programowania |
| **Echo** | 4.15.0 | Framework HTTP |
| **golang-jwt/jwt** | 5.3.1 | JWT |
| **pgx** | 5.8.0 | Klient PostgreSQL |
| **go-redis** | 9.7.0 | Klient Redis |
| **AWS SDK for Go v2** | - | Klient S3 (R2-compatible) |
| **Gorilla WebSocket** | 1.5.3 | WebSocket (BLIK) |
| **robfig/cron** | 3.0.1 | Zadania cron |
| **godotenv** | 1.5.1 | Ładowanie .env |
| **golang.org/x/crypto** | 0.46.0 | bcrypt, hashowanie |

---

## Baza danych i ORM

| Technologia | Wersja | Opis |
|-------------|--------|------|
| **PostgreSQL** | 16 | Baza danych (image: postgres:16-alpine) |
| **Prisma** | 6.19.2 | ORM, migracje, Prisma Studio |
| **Prisma Client** | 6.19.2 | Generowany klient DB |

---

## Cache i PubSub

| Technologia | Wersja | Opis |
|-------------|--------|------|
| **Redis** | 7 | Cache, pub/sub (image: redis:7-alpine) |
| **Upstash Redis** | 1.36.2 | Opcjonalnie: Redis w chmurze |
| **Upstash Ratelimit** | 2.0.8 | Rate limiting |

---

## Autentykacja

| Technologia | Opis |
|-------------|------|
| **NextAuth.js** | 5.0.0-beta.30 (frontend) |
| **@auth/prisma-adapter** | 2.11.1 |
| **bcryptjs** | 3.0.3 — hashowanie haseł |
| **JWT + HTTP-only cookies** | Sesje |

---

## Object Storage

| Technologia | Opis |
|-------------|------|
| **Cloudflare R2** | S3-compatible object storage |
| **@aws-sdk/client-s3** | 3.985.0 — klient S3 (R2) |

---

## Streaming wideo

| Technologia | Opis |
|-------------|------|
| **HLS** | HTTP Live Streaming |
| **Token-secured segments** | Autoryzacja segmentów wideo |

---

## Email

| Technologia | Opis |
|-------------|------|
| **Postfix** | Relay SMTP (image: boky/postfix) |
| **BillionMail** | Alternatywa — patrz `docs/BILLIONMAIL_SETUP.md` |

---

## Infrastruktura i DevOps

| Technologia | Opis |
|-------------|------|
| **Docker** | Konteneryzacja |
| **Docker Compose** | Orkiestracja serwisów |
| **Nginx** | Reverse proxy, WAF, rate limiting (image: nginx:alpine) |

---

## Monitoring i narzędzia dev

| Technologia | Opis |
|-------------|------|
| **Sentry** | @sentry/nextjs 10.38.0 |
| **Vitest** | 3.2.4 — testy jednostkowe |
| **ESLint** | 9.39.2 + eslint-config-next |
| **tsx** | 4.21.0 — wykonywanie TypeScript |

---

## Serwisy Docker

| Serwis | Port | Obraz |
|--------|------|-------|
| nginx | 80, 443 | nginx:alpine |
| frontend | 3000 | Custom (Dockerfile.frontend) |
| api | 8080 | Custom (backend/Dockerfile) |
| postgres | 5432 | postgres:16-alpine |
| redis | 6379 | redis:7-alpine |
| smtp | 587 | boky/postfix |

---

## Metody płatności

- **BLIK** — real-time WebSocket
- **Crypto** — BTC, ETH, LTC, USDC
- **PayPal**
- **Revolut**
