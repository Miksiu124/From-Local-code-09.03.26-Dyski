# Frontend Routes & Components

> Next.js App Router — route groups: `(admin)`, `(auth)`, `(user)`

## Strony (Routes)

### Public / User

| URL | Plik | Opis |
|---|---|---|
| `/` | `src/app/page.tsx` | Strona główna (ModelsGrid + featured carousel) |
| `/models` | `src/app/(user)/models/page.tsx` | Redirect/lista modeli |
| `/models/[slug]` | `src/app/(user)/models/[slug]/page.tsx` | Szczegóły modelu (ModelDetail) |
| `/content/[slug]` | `src/app/(user)/content/[slug]/` | Przeglądanie contentu |
| `/dashboard` | `src/app/(user)/dashboard/page.tsx` | Dashboard usera |
| `/favorites` | `src/app/(user)/favorites/page.tsx` | Ulubione |
| `/my-purchases` | `src/app/(user)/my-purchases/page.tsx` | Historia zakupów |
| `/purchase` | `src/app/(user)/purchase/page.tsx` | Proces zakupu |

### Auth

| URL | Plik |
|---|---|
| `/login` | `src/app/(auth)/login/page.tsx` |
| `/register` | `src/app/(auth)/register/page.tsx` |

### Admin (`/admin/*`)

| URL | Plik | Admin subpage |
|---|---|---|
| `/admin` | `src/app/(admin)/admin/page.tsx` | Dashboard admina |
| `/admin/analytics` | `.../admin/analytics/page.tsx` | Analityka |
| `/admin/models` | `.../admin/models/page.tsx` | Zarządzanie modelami |
| `/admin/packages` | `.../admin/packages/page.tsx` | Pakiety kredytów |
| `/admin/payments` | `.../admin/payments/page.tsx` | Zarządzanie płatnościami |
| `/admin/settings` | `.../admin/settings/page.tsx` | Ustawienia |
| `/admin/users` | `.../admin/users/page.tsx` | Zarządzanie użytkownikami |

## Kluczowe komponenty

### Layout & Navigation
- `src/components/layout/header.tsx` — Nagłówek (nawigacja, user menu, język)
- `src/components/layout/footer.tsx` — Stopka
- `src/components/layout/language-switcher.tsx` — Przełącznik PL/EN

### User Components (`src/components/user/`)
- **`models-grid.tsx`** (22KB) — Główny grid modeli + featured carousel, filtrowanie po krajach, cursor pagination, purchase modals
- **`model-detail.tsx`** (27KB) — Strona szczegółów modelu, galeria contentu, miniaturki, purchase flow
- **`video-player.tsx`** (21KB) — HLS player z quality selector, fullscreen, progress bar
- **`content-viewer.tsx`** (7KB) — Przeglądarka contentu (zdjęcia/video)
- **`favorites-grid.tsx`** (10KB) — Grid ulubionych

### Admin Components (`src/components/admin/`)
- `admin-sidebar.tsx` — Sidebar nawigacja admina
- `admin-payments-list.tsx` (20KB) — Lista płatności z approve/reject

### Payment Components (`src/components/payments/`)
- **`credit-purchase-flow.tsx`** (29KB) — Pełny flow zakupu (wybór pakietu → metoda → instrukcje → potwierdzenie)
- `payment-countdown.tsx` — Timer wygaśnięcia płatności

### UI Components (`src/components/ui/`)
- badge, button, card, dialog, input, skeleton — reusable primitives z CVA

### Shared
- `error-boundary.tsx` — React error boundary
- `access-required-popup.tsx` — Modal "kup dostęp"
- `providers.tsx` — SessionProvider + NextIntlClientProvider

## Lib (`src/lib/`)

| Plik | Opis |
|---|---|
| `api-client.ts` | `fetchApi<T>()` — SSR fetch z cookie forwarding |
| `api-errors.ts` | Error handling utilities |
| `access.ts` | Logika sprawdzania dostępu |
| `admin.ts` | Admin helper functions |
| `auth.ts` | Auth utilities |
| `db.ts` | Prisma client singleton |
| `env.ts` / `env-validate.ts` | Env vars validation |
| `logger.ts` | Logger z Sentry |
| `path-guard.ts` | Ochrona ścieżek |
| `r2-proof.ts` | R2 signed URL utilities |
| `rate-limit.ts` | Rate limiter (Upstash) |
| `session-server.ts` | Session management (server-side) |
| `utils.ts` | Ogólne utility functions |

## i18n

- Języki: **EN** (`src/messages/en.json`), **PL** (`src/messages/pl.json`)
- Konfiguracja: `src/i18n/request.ts`
- Plugin: `next-intl/plugin` w `next.config.ts`
