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

## Harmonogram (cron)

- Jedna specyfikacja crona: **`MARKETING_CRON`** (np. `0 9 * * *` UTC). Jeśli pusta, używane jest **`WINBACK_CRON`** (kompatybilność wstecz).
- Cron jest **rejestrowany**, gdy włączony jest **winback**, **social proof** lub **repeat buyer promo** (`WINBACK_EMAIL_ENABLED` albo `SOCIAL_PROOF_EMAIL_ENABLED` albo `REPEAT_BUYER_PROMO_EMAIL_ENABLED`).
- W jednym przebiegu wywoływane są kolejno włączone kampanie (winback → social proof → repeat buyer promo).

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
- **Szablon:** obowiązkowy **`FAVORITE_NUDGE_TEMPLATE_SLUG`** (np. krótki szablon w `marketing_templates_data.go` lub ten sam co winback — dopasuj zmienne przez `FAVORITE_NUDGE_TEMPLATE_DEFAULTS_JSON`).

## Zgoda i e-mail

- Wysyłki respektują **`users.marketing_email_opt_in`** (wypis: link z maila).
- **Nie** wysyłamy na podstawie samego adresu z propsów lejka (props są sanitizowane — brak e-maila w `growth_events`).
- Dalsze kampanie (np. „model X w katalogu”): ten sam wzorzec — segment SQL + `marketing_campaign_sends` / trigger + wbudowany szablon.

## Pliki w repo

- Implementacja: `ContentManager/backend/internal/marketing/campaigns/`
- Konfiguracja: `ContentManager/.env.production.example` (sekcja kampanii)
- Szablony HTML / slugi: `docs/MARKETING_EMAIL_TEMPLATES.md`
