# Audyt sieciowy — co strona wysyła do użytkownika (dyskiof.net)

**Data:** 2025-02-27  
**Narzędzie:** Chrome DevTools MCP (list_network_requests, evaluate_script)

---

## ✅ Podsumowanie — brak zagrożeń

Strona **nie wysyła** danych użytkownika do zewnętrznych trackerów reklamowych ani analitycznych.

---

## Zasoby ładowane przy wizycie (strona główna)

| Typ | Źródło | Uwagi |
|-----|--------|-------|
| HTML/CSS/JS | `dyskiof.net` | Wszystkie zasoby własne |
| Fonty | `dyskiof.net/_next/static/media/*.woff2` | Self-hosted (Next.js `next/font/google` bundle'uje lokalnie) |
| Obrazy | `dyskiof.net/api/models/*/thumbnail`, `.../avatar` | API → R2 (Cloudflare), proxy przez własne API |
| CDN | `dyskiof.net/cdn-cgi/speculation` | Cloudflare – prefetch (standard przy CF) |

**Brak zapytań do:**
- Google Analytics
- Facebook Pixel
- Inne trackery reklamowe

---

## Cookies i storage (sesja niezalogowana)

- **Cookies:** brak (pusta)
- **localStorage:** brak kluczy
- **Skrypty zewnętrzne:** brak – wszystkie z `dyskiof.net/_next/static/chunks/*.js`

---

## Sentry (opcjonalnie)

W `next.config.ts` jest wpis `connect-src ... https://*.ingest.sentry.io` – Sentry jest używany **tylko** gdy w `.env` ustawiono `SENTRY_DSN`. Bez DSN żadne dane nie trafiają do Sentry.

---

## Schemat JSON-LD (layout.tsx)

Strona emituje standardowy `WebSite` Schema.org dla SEO (nazwa, URL, SearchAction). Nie zawiera danych osobowych użytkownika.

---

## Rekomendacje

- Zachować brak zewnętrznych trackerów – dobra praktyka prywatności.
- Jeśli używasz Sentry – upewnij się, że `SENTRY_DSN` jest ustawiony tylko na produkcji i że znasz politykę Sentry wobec danych.
