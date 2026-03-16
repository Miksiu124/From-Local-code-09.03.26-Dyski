# Code Audit — Avatar CDN & Related Changes

**Data:** 15 marca 2026  
**Zakres:** workers/avatars-cdn, backend models handler, frontend avatar/header URLs, tsconfig, CSP

---

## 1. Executive Summary

| Obszar | Ocena | Uwagi |
|--------|-------|-------|
| **Bezpieczeństwo** | ✅ Dobrze | Path traversal zablokowany, brak ekspozycji kluczy |
| **Architektura** | ✅ OK | Fallback API → CDN, spójna konwencja ścieżek |
| **Worker avatars-cdn** | ⚠️ Do dopracowania | Brak walidacji formatu pliku, CORS `*` |
| **Backend** | ⚠️ Sugestia | Brak sanityzacji `folderName` w URL (defense in depth) |
| **Frontend** | ✅ OK | Poprawny fallback, CSP zaktualizowany |

---

## 2. Workers — avatars-cdn

### 2.1 Co działa dobrze

- **Path traversal** — `path.includes("..")` → 403
- **Prefix whitelist** — tylko `avatars/`
- **Metody** — tylko GET i HEAD
- **Cache-Control** — `max-age=86400`
- **Content-Type** — z R2 lub fallback `image/webp`

### 2.2 Do poprawy

| # | Problem | Priorytet | Rekomendacja |
|---|---------|-----------|--------------|
| 1 | **CORS `*`** | Średni | Ograniczyć do `https://dyskiof.net` (lub konkretnych domen) |
| 2 | **Brak walidacji formatu** | Niski | Opcjonalnie: regex `^avatars/[a-zA-Z0-9._-]+_(avatar|header)\.webp$` |
| 3 | **Wrangler — placeholder** | Niski | `avatars.twojadomena.com` → zaktualizować na `files.dyskiof.net` |
| 4 | **R2Bucket type** | Info | W Next.js build powodował błąd — naprawione przez exclude w tsconfig |

### 2.3 Enumeration

- Możliwe zgadywanie URL-i typu `avatars/{slug}_avatar.webp` przy znanych slugach.
- Slugi są publiczne w API (`/models`).
- Ryzyko: niskie — to tylko avatary/headery.

---

## 3. Backend — models handler

### 3.1 Co działa dobrze

- `avatarURL()` i `headerURL()` — spójna konwencja `avatars/{folder}_avatar.webp`, `_header.webp`
- `folderName` z DB (źródło kontrolowane)
- Puste `R2PublicURL` → puste URL-e → frontend używa API

### 3.2 Sugestie

| # | Sugestia | Priorytet |
|---|----------|-----------|
| 1 | **Sanityzacja folderName** | Niski | Przed `fmt.Sprintf` sprawdzić regex `^[A-Za-z0-9._-]+$` (jak w content handler `sanitizeSlug`). Obecnie Worker i tak blokuje `..`, ale defense in depth. |
| 2 | **Admin ImportR2** | Info | `FolderName` z requestu nie jest walidowany — rozważyć `sanitizeSlug` przy tworzeniu modeli. |

---

## 4. Frontend

### 4.1 Co działa dobrze

- Fallback: `avatarUrl \|\| /api/models/.../avatar`
- `headerUrl` dla Featured hero
- `ModelItem` ma `avatarUrl` i `headerUrl`

### 4.2 Niewykorzystana optymalizacja

- **Model thumbnail** (grid, side list) nadal używa `/api/models/:slug/thumbnail` zamiast `avatarUrl`.
- `/thumbnail` i `/avatar` używają tego samego handlera (`ModelAvatar`).
- **Rekomendacja:** Użyć `avatarUrl` także dla miniaturek modeli (te same obrazy, mniej requestów do API).

### 4.3 CSP (next.config.ts)

- `img-src` zawiera `https://files.dyskiof.net` ✅
- `images.remotePatterns` — tylko `**.r2.cloudflarestorage.com`; obrazy z `files.dyskiof.net` są ładowane przez zwykły `<img src>`, nie przez `next/image` — OK.

---

## 5. Bezpieczeństwo — podsumowanie

| Zagrożenie | Stan |
|------------|------|
| Path traversal (Worker) | ✅ Zablokowane |
| Ekspozycja kluczy R2 | ✅ Brak — publiczny dostęp bez kluczy w URL |
| CSRF (middleware) | ✅ Chronione dla state-changing |
| Rate limit | ✅ 400/min (500 dla OPTIONS) |
| XSS przez folderName | ✅ folderName z API, React escapuje |

---

## 6. Rekomendacje implementacyjne

### Wysoki priorytet
- Brak

### Średni priorytet
1. **Worker CORS** — ustawić `Access-Control-Allow-Origin: https://dyskiof.net` zamiast `*`.

### Niski priorytet
1. Backend: sanityzacja `folderName` w `avatarURL`/`headerURL`.
2. Frontend: użycie `avatarUrl` dla miniaturek modeli (grid, side list).
3. Wrangler: zaktualizować komentarz z domeną.

---

## 7. Weryfikacja

- [ ] Worker deploy na Cloudflare z domeną `files.dyskiof.net`
- [ ] `R2_PUBLIC_URL=https://files.dyskiof.net` w `.env` na VPS
- [ ] DevTools → Network: avatary/headery z `files.dyskiof.net`
- [ ] Fallback: wyłączyć R2_PUBLIC_URL → obrazy z `/api/models/...`
