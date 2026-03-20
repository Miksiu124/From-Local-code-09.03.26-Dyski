# Troubleshooting – odtwarzanie wideo (Network error)

Błąd „Network error — could not load the video” przy próbie odtworzenia na VPS.

---

## 0a. Segmenty idą na /models/... zamiast /api/... (pending)

Jeśli w DevTools → Network segmenty (.ts) idą na `dyskiof.net/models/...` zamiast `dyskiof.net/api/content/.../segment/...` lub R2:

- **Przyczyna:** Playlista zwraca względne URLe, a HLS.js rozwiązuje je względem złej bazy (np. URL strony).
- **Rozwiązanie:** API zawsze zwraca bezwzględne URLe. Sprawdź, czy playlistę pobierasz z `/api/content/{id}/playlist/master.m3u8` (nie z innego źródła).
- **Fallback:** Ustaw `HLS_USE_API_SEGMENTS=true` w `.env` — segmenty będą proxy’owane przez API zamiast presigned R2 (omija problemy CORS).

---

## 0. R2 CORS (wymagane dla presigned URLs)

Segmenty HLS (.ts) są serwowane z R2 przez presigned URLs. Przeglądarka wymaga CORS na buckecie R2.

**Konfiguracja CORS na buckecie R2:**

1. Cloudflare Dashboard → R2 → wybierz bucket (z wideo) → Settings → CORS Policy
2. Wklej konfigurację z `scripts/r2-cors-hls.json` lub ustaw ręcznie:

```json
[
  {
    "AllowedOrigins": ["https://dyskiof.net", "https://www.dyskiof.net", "http://localhost:3000"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["Range", "Content-Type"],
    "ExposeHeaders": ["Content-Length", "Content-Range", "Content-Type", "ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

3. Zapisz. Propagacja CORS może potrwać do 30 s.

**Weryfikacja:** DevTools → Network → request do segmentu (URL z `r2.cloudflarestorage.com`) → Response Headers powinny zawierać `Access-Control-Allow-Origin: https://dyskiof.net`.

---

## Auto-detekcja baseURL (od 2025-02)

API **automatycznie** wyznacza URLe segmentów HLS z żądania (`Host` + `X-Forwarded-Proto`), gdy `FRONTEND_URL` wskazuje na localhost lub frontend. Dzięki temu streaming działa za nginx/Cloudflare nawet bez poprawnego `FRONTEND_URL` w `.env`.

Jeśli nadal występuje błąd, sprawdź punkty poniżej.

---

## 1. FRONTEND_URL (opcjonalne, gdy auto-detekcja działa)

API buduje URLe segmentów HLS z `FRONTEND_URL` albo z nagłówków żądania. `FRONTEND_URL` zalecane na VPS:

```env
FRONTEND_URL=https://dyskiof.net
```

Jeśli ustawisz localhost/frontend, backend przełączy się na auto-detekcję z request.

---

## 2. Użytkownik nie zalogowany (401)

Endpoint `/api/content/:id/playlist/master.m3u8` wymaga uwierzytelnienia.

- Użytkownik musi być zalogowany (cookies z sesją).
- Jeśli sesja wygasła → „Network error”.

**Sprawdzenie:** DevTools → Network → request do `playlist/master.m3u8` → status 401 = brak sesji.

---

## 3. Brak dostępu do treści (403)

Odtwarzanie wymaga dostępu do treści (zakup lub rola admin).

- Brak zakupu → 403 Forbidden.
- HLS.js traktuje 403 jak błąd sieciowy.

**Sprawdzenie:** DevTools → Network → `playlist/master.m3u8` → status 403 = brak dostępu.

---

## 4. Brak plików w R2 (404)

Tabela `content_items` ma `hls_folder_path`, ale pliki mogą nie istnieć w R2.

**Sprawdzenie na VPS:**

```bash
docker compose exec api sh -c 'echo "SELECT id, hls_folder_path FROM content_items WHERE hls_folder_path IS NOT NULL LIMIT 5;" | psql $DATABASE_URL -t'
```

Sprawdź w Cloudflare R2, czy w danym kluczu/podkatalogu są pliki `.m3u8` i `.ts`.

---

## 5. Sesja / ciasteczka

- Przeglądarka musi wysyłać cookies (`credentials: include` w HLS.js).
- Domena ciasteczek musi zgadzać się z domeną strony (np. `dyskiof.net`).
- `SameSite`, `Secure` – sprawdź konfigurację sesji w API.

---

## 6. Nginx / proxy

W `nginx.conf.production` dla `/api/` powinno być m.in.:

```nginx
proxy_buffering off;
proxy_request_buffering off;
proxy_read_timeout 86400s;
proxy_send_timeout 86400s;
```

Bez tego długie requesty streamingu mogą się urywać.

---

## Szybki checklist

| # | Co sprawdzić | Jak |
|---|--------------|-----|
| 0 | R2 CORS | Bucket R2 → Settings → CORS Policy → `https://dyskiof.net` w AllowedOrigins |
| 0b | HLS_USE_API_SEGMENTS | Jeśli presigned nie działa: `HLS_USE_API_SEGMENTS=true` → segmenty przez API |
| 1 | FRONTEND_URL | Na VPS: `grep FRONTEND_URL .env` → powinno być `https://dyskiof.net` |
| 2 | Zalogowanie | Czy użytkownik jest zalogowany na stronie? |
| 3 | Dostęp do treści | Czy użytkownik kupił treść / jest adminem? |
| 4 | Status API | `curl -I https://dyskiof.net/api/health` |
| 5 | Logi API | `docker compose logs api --tail=50` przy odtwarzaniu |

---

## Test ręczny playlisty

Zalogowany użytkownik z dostępem może sprawdzić playlistę:

```bash
# Z ciasteczkami sesji (np. z przeglądarki – skopiuj Cookie)
curl -b "session=WARTOSC" "https://dyskiof.net/api/content/CONTENT_ID/playlist/master.m3u8"
```

- 200 + treść `.m3u8` → playlist jest serwowana.
- Adresy segmentów: presigned URLs (`...r2.cloudflarestorage.com/...`) — wymagają CORS na R2 (patrz sekcja 0).

Jeśli zamiast tego widzisz `http://localhost:3000/...` albo `http://frontend:3000/...` → popraw `FRONTEND_URL`.
