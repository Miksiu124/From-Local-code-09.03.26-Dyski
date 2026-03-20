# R2 CORS — konfiguracja dla HLS (presigned URLs)

Segmenty wideo (.ts) są serwowane z R2 przez presigned URLs. Przeglądarka wymaga CORS na buckecie.

## Szybka konfiguracja (Dashboard)

1. [Cloudflare Dashboard](https://dash.cloudflare.com) → R2 → wybierz bucket z wideo
2. **Settings** → **CORS Policy** → **Add CORS policy**
3. Wklej zawartość `r2-cors-hls.json` (zakładka JSON)
4. **Save**

## Plik `r2-cors-hls.json`

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

- **AllowedOrigins** — domena aplikacji (dyskiof.net) + localhost do dev
- **Range** — wymagany dla byte-range requests (HLS)
- **Content-Range** — odpowiedź na Range request

## Weryfikacja

1. Otwórz film na dyskiof.net
2. DevTools → Network → filtruj po `r2.cloudflarestorage.com` lub `cloudflare`
3. Kliknij request do segmentu (.ts)
4. **Response Headers** powinny zawierać: `Access-Control-Allow-Origin: https://dyskiof.net`

Brak tego nagłówka = CORS nie skonfigurowany lub zła domena w AllowedOrigins.
