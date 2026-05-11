# Kampanie marketingowe (Dyskiof)

Źródła danych: **`growth_events`** (POST `/api/growth-hacker`, lista nazw w `src/lib/growth-event-names.ts`) oraz **`users`** (e-mail po weryfikacji, `last_login_at`, `marketing_email_opt_in`).

## Architektura

| Warstwa | Rola |
|--------|------|
| **`internal/marketing/campaigns`** | Segmenty SQL, składanie zmiennych szablonu, cron `RunCronMarketing`, hook `GrowthHookAsync` po zapisie zdarzenia |
| **`marketing_campaign_sends`** | Cooldown / audyt wysyłek „batch” (winback, social proof, repeat buyer) |
| **`marketing_trigger_fires`** | Idempotencja triggerów zdarzeniowych (`UNIQUE(user_id, trigger_key)`) — np. jednorazowy e-mail po pierwszym ulubionym |
| **Redis** | Tokeny jednorazowe do linku wypisu (`/api/public/marketing-unsubscribe`) |

Wysyłka przez **`Mailer.SendMarketingTemplate`** (szablony wbudowane w backendzie, Resend lub SMTP — patrz `docs/EMAIL_VPS_SETUP.md`).

Segmenty, cap tygodniowy i zdarzenia audytu: **`docs/EMAIL_LIFECYCLE_SEGMENTS.md`**. A/B i KPI: **`docs/EMAIL_AB_TESTING_AND_KPIS.md`**.

## Jednorazowy podgląd wszystkich szablonów (QA)

**Nie** używaj `POST /api/admin/marketing/run-cron` do testów na swoją skrzynkę — wyśle kampanie do prawdziwych segmentów.

Zamiast tego (po wdrożeniu API z tą funkcją):

- **Sesja admin:** `POST /api/admin/marketing/email-samples` z JSON:
  - `to` — adres docelowy (np. `dyskiof@proton.me`)
  - `includeTransactional` — opcjonalnie `false`, domyślnie `true` (wysyłka też transakcyjnych: welcome, verify, reset, potwierdzenie płatności, porzucony koszyk, odrzucona wpłata, zmiana hasła, zmiana e-mail na `local+previewold@domena` jako „stary”).
- **Bearer (ops):** gdy ustawiony `MARKETING_OPS_KEY`: `POST /api/ops/marketing/email-samples` z tym samym JSON i nagłówkiem `Authorization: Bearer …`.

Marketingowe maile mają prefiks tematu **`[SAMPLE]`**; między wysyłkami jest ~400 ms, żeby nie trafiać w rate limit Resend.

Przykład (curl, produkcja — podstaw host i klucz):

```bash
curl -sS -X POST "https://TWOJA_DOMENA/api/ops/marketing/email-samples" \
  -H "Authorization: Bearer $MARKETING_OPS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"to":"dyskiof@proton.me","includeTransactional":true}'
```

## Harmonogram (cron)

- Jedna specyfikacja crona: **`MARKETING_CRON`** (np. `0 9 * * *` UTC). Jeśli pusta, używane jest **`WINBACK_CRON`** (kompatybilność wstecz).
- Cron jest **rejestrowany**, gdy włączony jest którykolwiek z: **winback**, **social proof**, **repeat buyer promo**, **starter offer**, **at-risk**, **lapsed buyer** (odpowiednie `*_EMAIL_ENABLED=1`).
- W jednym przebiegu wywoływane są kolejno: winback → social proof → repeat buyer → starter offer → at-risk paid → lapsed buyer (każda funkcja sama się wyłącza, jeśli flaga = off).

## Plan użycia limitu 50k / miesiąc

Nie traktuj większego limitu jak zaproszenia do jednego masowego newslettera. Najlepszy zwrot powinny dać sekwencje oparte na intencji:

1. **Najpierw repeat buyer promo** — użytkownicy, którzy już kupili, mają najkrótszą drogę do kolejnej transakcji. To kampania jednorazowa, więc można ją puścić mocniej (`REPEAT_BUYER_BATCH_LIMIT=300-800`) i mierzyć kliknięcia przez `/l/vip10-a,b,c`.
2. **Potem social proof co 14-21 dni** — tylko do osób, które realnie oglądały treści i ucichły. Ustaw krótszy cooldown niż winback, ale nie schodź poniżej 30 dni bez danych o wypisach.
3. **Winback jako wolniejszy rezerwuar** — dla zimnych kont trzymaj dłuższą nieaktywność i cooldown. Ta kampania buduje zasięg, ale będzie miała słabszą konwersję niż repeat buyer.
4. **Trigger po ulubionym** — włącz `FAVORITE_NUDGE_EMAIL_ENABLED=1`, bo to mail po zachowaniu z wysoką intencją. Domyślny szablon to `favorite-nudge`, CTA prowadzi do `/favorites`.
5. **Kontrola wolumenu** — na starcie trzymaj łączny wolumen poniżej 20-30% nowego limitu, sprawdź odbicia, wypisy i kliknięcia, dopiero potem zwiększaj batch.

## Kampanie „batch” (segment z SQL)

### 1. Winback (`WINBACK_EMAIL_ENABLED`)

- **Kto:** zweryfikowany e-mail, nie zbanowany, nie ADMIN, `marketing_email_opt_in`, brak wysyłki `winback_soft` w oknie cooldown.
- **Nieaktywność:** `GREATEST(last_login_at, max(created_at z growth_events))` starsze niż `WINBACK_INACTIVITY_DAYS`.
- **Szablon:** `WINBACK_TEMPLATE_SLUG` (domyślnie `winback-soft`).

### 2. Social proof re-engage (`SOCIAL_PROOF_EMAIL_ENABLED`)

- **Kto:** jak wyżej + w oknie **`SOCIAL_PROOF_ENGAGEMENT_LOOKBACK_DAYS`** był co najmniej jeden event: `first_play`, `content_detail_view`, `video_engagement` (sygnał „kiedyś angażowali się w treść”).
- **Cisza:** ta sama miara „ostatniej aktywności” co winback, krótszy próg **`SOCIAL_PROOF_INACTIVITY_DAYS`** (domyślnie 14).
- **Cooldown:** osobny licznik w `marketing_campaign_sends` pod kampanią `social_proof_drop`.
- **Szablon:** `SOCIAL_PROOF_TEMPLATE_SLUG` (domyślnie `social-proof-drop`). Tytuł / proof z env lub `*_TEMPLATE_DEFAULTS_JSON`.

### 3. Repeat buyer + kod rabatowy (`REPEAT_BUYER_PROMO_EMAIL_ENABLED`)

- **Kto:** jak winback (zweryfikowany e-mail, zgoda marketingowa) **oraz** kiedykolwiek zakup: wiersz w `purchases` **albo** `credit_purchases` ze statusem `APPROVED`.
- **Jednorazowo na konto:** wpis w `marketing_campaign_sends` pod kampanią `repeat_buyer_promo_v1` (brak cooldownu — nie wysyłamy ponownie).
- **Kod / minimum:** domyślny kod z migracji `DYSKIOF10BK` (10%, `min_purchase_amount` = 50, `once_per_user`). Dostosuj w panelu **Kody rabatowe** lub env `REPEAT_BUYER_PROMO_CODE`.
- **A/B/C klików:** w mailu `ctaUrl` wskazuje na `https://…/l/{slug}` — trzy slugi (`vip10-a` / `vip10-b` / `vip10-c` z migracji) zapisują wizyty w `link_visits` i atrybut `utm_email_ab` w query na `/purchase`.
- **Szablon:** `REPEAT_BUYER_TEMPLATE_SLUG` (domyślnie `repeat-buyer-10`). Wymagane zmienne w szablonie: `firstName`, `hookLine`, `ctaUrl`, `promoCode`, `promoTerms`, `unsubscribeUrl`, `siteName` (+ opcjonalnie `stat1` itd. przez `REPEAT_BUYER_TEMPLATE_DEFAULTS_JSON`).

## Kampanie po zdarzeniu (hook po `InsertEvent`)

Po udanym zapisie wiersza w `growth_events` wywoływany jest hook (goroutine, timeout ~45 s), **bez blokowania** odpowiedzi HTTP.

### Ulubione (`FAVORITE_NUDGE_EMAIL_ENABLED`)

- Zdarzenie: `favorite_toggled` z `favorited: true` (frontend: `trackFavoriteToggled`).
- Wymaga zalogowanego użytkownika (`user_id` w zdarzeniu).
- **Jednorazowo na konto:** `marketing_trigger_fires` z kluczem `favorite_nudge_v1`.
- **Szablon:** domyślnie **`favorite-nudge`**. Można nadpisać przez `FAVORITE_NUDGE_TEMPLATE_SLUG`, jeśli testujesz inną wersję.

### Welcome value stack (`WELCOME_EMAIL_ENABLED`)

- **Kiedy:** po pomyślnej weryfikacji e-maila (link) albo po **pierwszym** utworzeniu konta Discord (nowy wiersz `users`).
- **Jednorazowo:** `marketing_trigger_fires` + audyt `marketing_campaign_sends` (`welcome_value_v1`).
- **Szablon:** `WELCOME_TEMPLATE_SLUG` (domyślnie `welcome-value-stack`). Zdarzenie audytu: `lifecycle_welcome_sent`.

### Starter offer (`STARTER_OFFER_EMAIL_ENABLED`)

- **Kto:** `email_verified` w `growth_events`, okno **`STARTER_OFFER_DAYS_MIN`…`STARTER_OFFER_DAYS_MAX`** od pierwszej weryfikacji, brak `purchase_completed` / brak zatwierdzonego `credit_purchases`.
- **Cooldown:** kampania `starter_offer_v1` + limit tygodniowy (patrz `lifecycle_revenue.go`).
- **Szablon:** `starter-offer-welcome`. Audyt: `lifecycle_starter_offer_sent`.

### At-risk (kupujący, krótsza cisza) (`AT_RISK_EMAIL_ENABLED`)

- **Kto:** kiedykolwiek zakup (`purchase_completed` lub `credit_purchases.APPROVED`) + pasmo nieaktywności między `AT_RISK_INACTIVE_DAYS_MIN` a `AT_RISK_INACTIVE_DAYS_MAX` (ta sama miara co winback).
- **Cooldown:** `at_risk_paid_v1`. Audyt: `lifecycle_at_risk_sent`.

### Lapsed buyer (`LAPSED_BUYER_EMAIL_ENABLED`)

- **Kto:** jak wyżej (kupujący), głębsze pasmo nieaktywności (`LAPSED_INACTIVE_DAYS_*`) przed długim winbackiem; konfiguracja jest **docinana** tak, by nie kolidować z pasmem at-risk.
- **Cooldown:** `lapsed_buyer_v1`. Audyt: `lifecycle_lapsed_sent`.

## Zgoda i e-mail

- Wysyłki respektują **`users.marketing_email_opt_in`** (wypis: link z maila).
- **Nie** wysyłamy na podstawie samego adresu z propsów lejka (props są sanitizowane — brak e-maila w `growth_events`).
- Dalsze kampanie (np. „model X w katalogu”): ten sam wzorzec — segment SQL + `marketing_campaign_sends` / trigger + wbudowany szablon.

## Pliki w repo

- Implementacja: `ContentManager/backend/internal/marketing/campaigns/`
- Konfiguracja: `ContentManager/.env.production.example` (sekcja kampanii)
- Szablony HTML / slugi: `docs/MARKETING_EMAIL_TEMPLATES.md`
