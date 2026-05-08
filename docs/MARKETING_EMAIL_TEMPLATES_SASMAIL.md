# Szablony marketingowe → Saasmail (Dyskiof)

## Jak wdrożyć w Saasmail (panel)

1. Zaloguj się do panelu (np. `https://saasmail-dyskiof.hardliferoot.workers.dev`).
2. W menu wybierz **Templates**.
3. **New template** (lub odpowiednik „Utwórz”) i dla każdej sekcji poniżej:
   - **Slug** — dokładnie jak w nagłówku sekcji (tylko **małe litery, cyfry, myślnik** `a-z0-9-`; **bez** `_`).
   - **Name** — krótka nazwa po polsku (jak w dokumencie).
   - **Subject** — skopiuj z bloku „Subject”.
   - **Body HTML** — wklej całą zawartość z bloku `` ```html `` (od `<!DOCTYPE` do końca).
   - **From** (jeśli pole jest): opcjonalnie `newsletter@dyskiof.net` — musi być na liście dozwolonych inboxów / tożsamości w Saasmail i w Email Sending. Admin może zostawić globalny szablon bez `from` i wybierać adres przy wysyłce.
4. Zapisz. Powtórz dla pozostałych szablonów.

**Wysyłka testowa z panelu:** po zapisaniu szablonu użyj flow wysyłki szablonem (jeśli jest w UI) albo **API** (poniżej).

### Skrypt `scripts/saasmail-seed-marketing-templates.mjs` (upsert)

Z katalogu **`ContentManager/`**:

```bash
export SAASMAIL_SEND_URL="https://TWOJ-WORKER.workers.dev/api/send"
export SAASMAIL_API_KEY="sk_..."
# opcjonalnie: adres „from” przypięty do szablonu (wymaga uprawnień inboxu)
# export SAASMAIL_FROM_ADDRESS="newsletter@dyskiof.net"

node scripts/saasmail-seed-marketing-templates.mjs --dry-run   # tylko lista
node scripts/saasmail-seed-marketing-templates.mjs
```

Albo: `npm run saasmail:templates` (to samo co `node …` bez `--dry-run`; dla dry-run nadal `node … --dry-run`).

Skrypt: dla każdego slug-a robi **`GET /api/email-templates/{slug}`** — jeśli **404**, to **`POST /api/email-templates`**, w przeciwnym razie **`PUT /api/email-templates/{slug}`** (nadpisanie treści).

---

## Jak wdrożyć przez API (curl / skrypt)

Potrzebujesz **klucza API** Saasmail (`sk_…`, zakładka **API** w panelu) i sesji lub samego Bearer dla `POST`.

**Utworzenie szablonu** (admin lub member z `fromAddress` przy globalnych — patrz worker):

```http
POST https://TWOJ-WORKER.workers.dev/api/email-templates
Authorization: Bearer sk_...
Content-Type: application/json

{
  "slug": "catalog-model-updated",
  "name": "Aktualizacja modelu w katalogu",
  "subject": "{{modelName}} — zaktualizowaliśmy materiały w katalogu",
  "bodyHtml": "<!DOCTYPE html>...",
  "fromAddress": null
}
```

`bodyHtml` musi być **jednym stringiem JSON** (w praktyce: plik `body.json` + `curl @body.json` albo generator z repo).

**Wysyłka do jednego odbiorcy:**

```http
POST https://TWOJ-WORKER.workers.dev/api/email-templates/catalog-model-updated/send
Authorization: Bearer sk_...
Content-Type: application/json

{
  "to": "user@example.com",
  "fromAddress": "newsletter@dyskiof.net",
  "variables": {
    "firstName": "Ania",
    "modelName": "Model XYZ",
    "updateSummary": "Nowe rendery i poprawki materiałów.",
    "ctaUrl": "https://dyskiof.net/...",
    "unsubscribeUrl": "https://dyskiof.net/unsubscribe?token=...",
    "siteName": "Dyskiof"
  }
}
```

Pełna specyfikacja pól: **`/doc`** (Swagger) na workerze. **Wymagane zmienne** dla danego szablonu: `GET https://TWOJ-WORKER.workers.dev/api/email-templates/{slug}/variables` (ten sam Bearer).

---

Składnia zmiennych Saasmail: `{{zmienna}}` (w treści: litery, cyfry, **`_`** w nazwie zmiennej są OK, np. `{{firstName}}`). **Slug szablonu** w URL to osobna reguła: tylko `a-z`, `0-9`, `-`.

**Zanim wyślesz promocje:** zgoda marketingowa, link **wypisu** w stopce (podstaw `{{unsubscribeUrl}}` z backendu), nie mieszaj z transakcyjnym `noreply@` bez sensu — rozważ `newsletter@dyskiof.net` (domena w Email Sending + inbox w Saasmail).

---

## 1. `catalog-model-updated` — „Twój model ma aktualizację”

**Nazwa (UI):** Aktualizacja modelu w katalogu  
**Slug:** `catalog-model-updated`  
**From (opcjonalnie w szablonie):** `newsletter@dyskiof.net` lub Twój adres marketingowy  

**Subject:**
```
{{modelName}} — zaktualizowaliśmy materiały w katalogu
```

**Zmienne:** `firstName`, `modelName`, `updateSummary`, `ctaUrl`, `unsubscribeUrl`, `siteName`

**body_html** (wklej jako jedną linię lub zachowaj znaki; Saasmail przyjmuje zwykły string):

```html
<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#0f1117;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#e6e8ee;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f1117;padding:32px 16px;"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:560px;background:#161922;border-radius:12px;border:1px solid #252a3a;">
<tr><td style="padding:28px 28px 8px;font-size:13px;color:#8b93a7;">{{siteName}}</td></tr>
<tr><td style="padding:8px 28px 4px;font-size:22px;font-weight:650;color:#f4f5f8;line-height:1.25;">{{modelName}} ma świeżą wersję</td></tr>
<tr><td style="padding:12px 28px 0;font-size:15px;color:#c5cad8;line-height:1.55;">Cześć {{firstName}},</td></tr>
<tr><td style="padding:12px 28px 0;font-size:15px;color:#c5cad8;line-height:1.55;">{{updateSummary}}</td></tr>
<tr><td style="padding:24px 28px 32px;"><a href="{{ctaUrl}}" style="display:inline-block;background:#5b8cff;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:8px;">Otwórz w katalogu</a></td></tr>
<tr><td style="padding:0 28px 28px;font-size:12px;color:#6b7280;line-height:1.5;">Nie chcesz takich powiadomień? <a href="{{unsubscribeUrl}}" style="color:#8b93a7;">Wypisz się</a>.</td></tr>
</table></td></tr></table></body></html>
```

**Growth-hacker hook:** krótka zmiana + jeden CTA; brak ściany tekstu.

---

## 2. `promo-limited` — krótka promka (kod / deadline)

**Nazwa:** Promocja ograniczona czasowo  
**Slug:** `promo-limited`

**Subject:**
```
{{promoTitle}} — kod {{promoCode}} (do {{promoExpiry}})
```

**Zmienne:** `firstName`, `promoTitle`, `promoCode`, `promoExpiry`, `promoUrl`, `unsubscribeUrl`, `siteName`

```html
<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#0f1117;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f1117;padding:32px 16px;"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:560px;background:#161922;border-radius:12px;border:1px solid #252a3a;">
<tr><td style="padding:28px 28px 8px;font-size:13px;color:#8b93a7;">{{siteName}}</td></tr>
<tr><td style="padding:8px 28px 4px;font-size:20px;font-weight:650;color:#f4f5f8;">{{promoTitle}}</td></tr>
<tr><td style="padding:16px 28px 0;font-size:15px;color:#c5cad8;line-height:1.55;">Hej {{firstName}}, mamy coś na dziś: użyj kodu <strong style="color:#f4f5f8;">{{promoCode}}</strong> przy kasie. Ważne do <strong style="color:#f4f5f8;">{{promoExpiry}}</strong>.</td></tr>
<tr><td style="padding:24px 28px 32px;"><a href="{{promoUrl}}" style="display:inline-block;background:#22c55e;color:#0f1117;text-decoration:none;font-weight:700;font-size:14px;padding:12px 22px;border-radius:8px;">Skorzystaj</a></td></tr>
<tr><td style="padding:0 28px 28px;font-size:12px;color:#6b7280;"><a href="{{unsubscribeUrl}}" style="color:#8b93a7;">Wypisz się z newslettera</a></td></tr>
</table></td></tr></table></body></html>
```

---

## 3. `winback-soft` — delikatny win-back (bez presji)

**Nazwa:** Win-back — miękki  
**Slug:** `winback-soft`

**Subject:**
```
{{firstName}}, tęsknimy — coś nowego czeka w {{siteName}}
```

**Zmienne:** `firstName`, `hookLine`, `ctaUrl`, `unsubscribeUrl`, `siteName`

```html
<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#0f1117;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f1117;padding:32px 16px;"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:560px;background:#161922;border-radius:12px;border:1px solid #252a3a;">
<tr><td style="padding:28px 28px 8px;font-size:13px;color:#8b93a7;">{{siteName}}</td></tr>
<tr><td style="padding:8px 28px 4px;font-size:19px;font-weight:650;color:#f4f5f8;">Dawno nie widzieliśmy Cię w katalogu</td></tr>
<tr><td style="padding:14px 28px 0;font-size:15px;color:#c5cad8;line-height:1.55;">{{hookLine}}</td></tr>
<tr><td style="padding:22px 28px 32px;"><a href="{{ctaUrl}}" style="display:inline-block;background:#5b8cff;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:8px;">Zajrzyj na chwilę</a></td></tr>
<tr><td style="padding:0 28px 28px;font-size:12px;color:#6b7280;"><a href="{{unsubscribeUrl}}" style="color:#8b93a7;">Wypisz się</a></td></tr>
</table></td></tr></table></body></html>
```

**Przykład `hookLine`:** „Dodaliśmy nowe materiały i poprawiliśmy wyszukiwanie — warto rzucić okiem.”

---

## 4. `social-proof-drop` — „Inni oglądają to teraz” (lekki FOMO)

**Nazwa:** Social proof — drop  
**Slug:** `social-proof-drop`

**Subject:**
```
Teraz popularne: {{trendingTitle}}
```

**Zmienne:** `firstName`, `trendingTitle`, `proofLine`, `ctaUrl`, `unsubscribeUrl`, `siteName`

```html
<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#0f1117;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f1117;padding:32px 16px;"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:560px;background:#161922;border-radius:12px;border:1px solid #252a3a;">
<tr><td style="padding:28px 28px 8px;font-size:13px;color:#8b93a7;">{{siteName}}</td></tr>
<tr><td style="padding:8px 28px 4px;font-size:20px;font-weight:650;color:#f4f5f8;">{{trendingTitle}}</td></tr>
<tr><td style="padding:14px 28px 0;font-size:14px;color:#93c5fd;line-height:1.5;">{{proofLine}}</td></tr>
<tr><td style="padding:12px 28px 0;font-size:15px;color:#c5cad8;line-height:1.55;">{{firstName}}, krótka zajawka — wejdź i zobacz, czemu to wraca na top.</td></tr>
<tr><td style="padding:22px 28px 32px;"><a href="{{ctaUrl}}" style="display:inline-block;background:#5b8cff;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:8px;">Zobacz w katalogu</a></td></tr>
<tr><td style="padding:0 28px 28px;font-size:12px;color:#6b7280;"><a href="{{unsubscribeUrl}}" style="color:#8b93a7;">Wypisz się</a></td></tr>
</table></td></tr></table></body></html>
```

**Przykład `proofLine`:** „W ostatnich 24 h ponad 120 osób otworzyło ten materiał.”

### Szablon `repeat-buyer-10` (kampania „kiedykolwiek kupili”)

Zmienne: `firstName`, `hookLine`, `ctaUrl` (pełny URL do `/l/vip10-a` itd.), `promoCode`, `promoTerms`, `unsubscribeUrl`, `siteName`.

```html
<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#0f1117;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f1117;padding:32px 16px;"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:560px;background:#161922;border-radius:12px;border:1px solid #252a3a;">
<tr><td style="padding:28px 28px 8px;font-size:13px;color:#8b93a7;">{{siteName}}</td></tr>
<tr><td style="padding:8px 28px 4px;font-size:20px;font-weight:650;color:#f4f5f8;">Dziękujemy, że jesteś z nami</td></tr>
<tr><td style="padding:14px 28px 0;font-size:15px;color:#c5cad8;line-height:1.55;">{{hookLine}}</td></tr>
<tr><td style="padding:12px 28px 0;font-size:14px;color:#93c5fd;">Kod: <strong style="color:#e5e7eb;">{{promoCode}}</strong></td></tr>
<tr><td style="padding:8px 28px 0;font-size:12px;color:#8b93a7;line-height:1.45;">{{promoTerms}}</td></tr>
<tr><td style="padding:22px 28px 32px;"><a href="{{ctaUrl}}" style="display:inline-block;background:#5b8cff;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:8px;">Doładuj z rabatem</a></td></tr>
<tr><td style="padding:0 28px 28px;font-size:12px;color:#6b7280;"><a href="{{unsubscribeUrl}}" style="color:#8b93a7;">Wypisz się</a></td></tr>
</table></td></tr></table></body></html>
```

---

## Wysyłka z backendu (skrót)

Po utworzeniu szablonu w Saasmail wywołujesz **`POST /api/email-templates/{slug}/send`** (Bearer `sk_…`) z JSON: `to`, `fromAddress`, `variables` — szczegóły w **`/doc`** na workerze.

Z Dyskiof (Go):

- **Kampanie z lejka (cron + zdarzenia):** `docs/MARKETING_CAMPAIGNS.md` — winback, social proof z `growth_events`, jednorazowy e-mail po `favorite_toggled`, **repeat buyer** (`repeat-buyer-10`, linki `/l/vip10-a|b|c`); harmonogram `MARKETING_CRON`, env w `.env.production.example`.
- **Inne kampanie** — zapytanie w Postgres + throttle albo Sequences w Saasmail.

Dla **„użytkownicy z modelem X”** — jednorazowa kampania: zapytanie w Postgres (kto ma ulubiony / zakup / tag modelu), pętla z **throttle** (np. 30–50/min) i `variables` per user; dla serii — **Sequences** w Saasmail + enroll po API.

---

## Checklista growth

| Cel | Slug szablonu | Metryka |
|-----|----------------|---------|
| Aktualizacja assetu | `catalog-model-updated` | CTR z `ctaUrl` |
| Kod / flash sale | `promo-limited` | użycia kodu / konwersja |
| Reaktywacja | `winback-soft` | powrót sesji (`/api/growth-hacker`) |
| Powrót kupujących + kod 10% / min 50 zł | `repeat-buyer-10` | `link_visits` per `/l/vip10-a|b|c`, użycia `DYSKIOF10BK` |

Iteruj **temat** A/B ręcznie (dwa szablony / dwa slugi) przy małej skali — wystarczy.
