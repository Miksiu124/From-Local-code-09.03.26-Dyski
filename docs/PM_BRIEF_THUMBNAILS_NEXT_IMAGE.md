# PM Brief — Miniatury przez public URL + next/image

**Data:** 2026-03-16  
**Dla:** Senior Developer  
**Od:** Senior Project Manager  
**Cel:** Bezpieczne przejście na public URL dla miniaturek na stronie głównej, zachowanie proxy dla content, stopniowe wprowadzenie `next/image`.

---

## 1. Kontekst biznesowy

- Użytkownicy zgłaszają wolne ładowanie zdjęć/filmów i strony.
- Miniatury na stronie głównej mogą iść przez public URL (CDN).
- Miniatury w folderach content (galerie modeli) — ryzyko leakowania struktury R2 przy public URL.
- Wprowadzamy `next/image` stopniowo dla lepszej wydajności i optymalizacji formatów.

---

## 2. Podział odpowiedzialności (co może być public, co nie)

| Lokalizacja | Typ | Obecny URL | Public URL? | Uzasadnienie |
|-------------|-----|------------|-------------|--------------|
| **Strona główna** | Avatar modelu | `/api/models/:slug/avatar` | ✅ Tak | Slug jest publiczny, ścieżka przewidywalna `avatars/{slug}_avatar.webp` |
| **Strona główna** | Header modelu | `/api/models/:slug/header` | ✅ Tak | Jak wyżej, `avatars/{slug}_header.webp` |
| **Strona główna** | Miniatura modelu (grid) | `/api/models/:slug/thumbnail` | ✅ Tak | Ten sam handler co avatar — ten sam plik. Użyć `avatarUrl` z API. |
| **Folder content** | Miniatura treści (film/zdjęcie) | `/api/content/:contentItemId/thumbnail` | ❌ Nie (na razie) | contentItemId → DB lookup → R2 path. Public URL ujawniłby strukturę bucketu (np. `model/video123_thumb.webp`), umożliwiając enumerację. Zostaje proxy. |

---

## 3. Ryzyko leakowania R2 — content thumbnails

**Dlaczego content NIE może iść przez prosty public URL:**

- URL content: `/api/content/{uuid}/thumbnail` — UUID nie ujawnia ścieżki R2.
- Backend: `contentItemId` → zapytanie do DB → `thumbnail_path` / `hls_folder_path` → GetObject z R2.
- Gdyby CDN serwował pliki bezpośrednio, URL musiałby zawierać ścieżkę R2, np. `https://cdn.example.com/modelname/video_source_thumbnail.webp`.
- Atakujący mógłby enumerować: `modelname/`, `modelname/video2_thumbnail.webp` itd. — leak struktury bucketu i potencjalnie nieopłacone treści.

**Opcje na przyszłość (poza scope tego briefu):**

- Signed URLs (pre-signed, krótki TTL).
- Worker CDN z lookup po contentItemId (Worker ma dostęp do DB/R2).
- Token w URL weryfikowany przez backend.

---

## 4. Plan implementacji (fazy)

### Faza 1: Public URL dla miniaturek na stronie głównej (bez next/image)

**Zakres:** Strona główna — grid modeli, hero featured, side list.

**Kroki:**

1. **Backend / Ops**
   - Upewnić się, że `R2_PUBLIC_URL=https://files.dyskiof.net` jest ustawione w `.env` na VPS.
   - Worker `avatars-cdn` (lub równoważny) serwuje `avatars/{slug}_avatar.webp` i `avatars/{slug}_header.webp` z R2.
   - Backend już przekierowuje (302) avatar/header na CDN, gdy `R2PublicURL` jest ustawione.

2. **Frontend — użycie avatarUrl/headerUrl zamiast API**
   - API `/models` zwraca `avatarUrl` i `headerUrl` (gdy R2PublicURL ustawione) — bezpośrednie URL-e CDN.
   - Zmienić `models-grid.tsx`:
     - Hero header: `src={heroModel.headerUrl || `/api/models/${heroModel.folderName}/header`}` → już OK, ale upewnić się że `headerUrl` jest używane gdy dostępne.
     - Grid cards: `src={model.avatarUrl || `/api/models/${model.folderName}/thumbnail`}` dla głównej miniatury (obecnie używa `/thumbnail` — zmienić na `avatarUrl` z fallbackiem).
     - Avatar na karcie: `src={model.avatarUrl || ...}` — już jest.
   - Side list (featured): analogicznie — `avatarUrl` z fallbackiem na `/api/.../thumbnail`.

3. **Weryfikacja**
   - DevTools → Network: obrazy z `files.dyskiof.net`, nie z `/api/...`.
   - Fallback: gdy `R2_PUBLIC_URL` puste, obrazy nadal z `/api/...`.

**Pliki do edycji:** `src/components/user/models-grid.tsx`

---

### Faza 2: next/image dla miniaturek na stronie głównej

**Zakres:** Te same obrazy co w Fazie 1 — avatary i headery modeli (public URL).

**Kroki:**

1. **next.config.ts**
   - Dodać `files.dyskiof.net` do `images.remotePatterns`:
     ```ts
     {
       protocol: "https",
       hostname: "files.dyskiof.net",
     },
     ```
   - CSP `img-src` już zawiera `https://files.dyskiof.net` — OK.

2. **Komponent NextImageWithFallback**
   - Stworzyć wrapper `NextImageWithFallback` (lub rozszerzyć istniejący `RetryImage`), który:
     - Używa `next/image` gdy `src` jest z domeny CDN (public URL).
     - Ma fallback na `<img>` gdy błąd lub gdy src to `/api/...` (proxy).
   - `next/image` wymaga `width` i `height` lub `fill` — ustalić rozmiary dla grid (np. aspect 3/4), hero, side list.

3. **Zastosowanie w models-grid**
   - Hero: `next/image` z `fill`, `sizes`, `priority` dla LCP.
   - Grid cards: `next/image` z `width`/`height` lub `fill`, `loading="lazy"`, `sizes`.
   - Side list: `next/image` z odpowiednimi wymiarami.

4. **Zachowanie RetryImage**
   - RetryImage ma retry przy błędzie — `next/image` nie. Wrapper powinien obsłużyć `onError` i fallback na `<img>`.

**Pliki do edycji:** `next.config.ts`, nowy `src/components/ui/next-image-with-fallback.tsx`, `models-grid.tsx`

---

### Faza 3: Content thumbnails — zostają przy proxy (bez zmian)

**Zakres:** Galerie w folderach modeli (`model-detail.tsx`), favorites, content-viewer.

**Decyzja:** Na razie **bez zmian**. Miniatury content nadal przez `/api/content/:contentItemId/thumbnail` (proxy backend → R2).

**Opcjonalnie (niski priorytet):** Dodać `loading="lazy"` i `fetchpriority` tam gdzie brakuje. Sprawdzić czy `LazyRetryImage` jest używane w galeriach content.

---

### Faza 4 (opcjonalna, przyszłość): next/image dla content przez proxy

**Zakres:** Miniatury content (`/api/content/:id/thumbnail`) — nadal proxy, ale przez `next/image` z `src` wskazującym na `/api/...`.

**Uwaga:** `next/image` z lokalnym src (`/api/...`) — Next.js może optymalizować obrazy przez swój Image Optimization API. Wymaga konfiguracji `images.domains` lub `images.remotePatterns` dla domeny własnej (np. relative path). Sprawdzić dokumentację Next.js dla `src` zaczynającego się od `/`.

---

## 5. Checklist dla developera

### Faza 1
- [ ] `R2_PUBLIC_URL` ustawione na VPS (lub w .env) — **wymaga Ops**
- [x] models-grid: hero używa `headerUrl` gdy dostępne
- [x] models-grid: grid cards używają `avatarUrl` dla głównej miniatury (z fallbackiem na `/api/.../thumbnail`)
- [x] models-grid: side list używa `avatarUrl` (z fallbackiem)
- [ ] Test: Network pokazuje requesty do `files.dyskiof.net` (gdy R2_PUBLIC_URL ustawione)
- [ ] Test: Wyłączenie R2_PUBLIC_URL → fallback na /api działa

### Faza 2
- [x] next.config: `files.dyskiof.net` w remotePatterns
- [x] NextImageWithFallback (lub ekwiwalent) z retry/fallback
- [x] models-grid: hero z next/image, priority
- [x] models-grid: grid z next/image, lazy
- [ ] Test: obrazy w WebP/AVIF (DevTools)
- [ ] Test: brak regresji przy błędach ładowania

### Faza 3
- [ ] Brak zmian — content przez proxy
- [ ] (Opcjonalnie) audit LazyRetryImage w content

---

## 6. Kryteria akceptacji

1. Strona główna ładuje avatary/headery z CDN (gdy R2_PUBLIC_URL ustawione).
2. Miniatury content (galerie) nadal przez proxy — brak ujawniania ścieżek R2.
3. next/image stosowane stopniowo tylko tam, gdzie src to public URL (CDN).
4. Fallback na proxy działa gdy CDN niedostępny lub R2_PUBLIC_URL puste.
5. Brak regresji: retry przy błędzie, lazy loading, dostępność.

---

## 7. Dokumentacja referencyjna

- `docs/CODE_AUDIT_AVATAR_CDN_2026-03.md` — audyt CDN, rekomendacje
- `backend/internal/content/handler.go` — ModelAvatar, ModelHeader, Thumbnail (content)
- `backend/internal/models/handler.go` — avatarURL(), headerURL()
- Next.js: [Image Optimization](https://nextjs.org/docs/app/building-your-application/optimizing/images)
