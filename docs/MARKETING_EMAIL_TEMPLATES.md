# Szablony marketingowe (wbudowane w backend)

Kampanie z `docs/MARKETING_CAMPAIGNS.md` wysyłają HTML przez **`Mailer.SendMarketingTemplate`** — treść nie jest trzymana w zewnętrznej aplikacji, tylko w kodzie Go.

## Gdzie w repo

- Definicje (slug, temat, `body_html`): `backend/internal/mailer/marketing_templates_data.go`
- Interpolacja `{{zmienna}}` i wysyłka: `backend/internal/mailer/marketing_templates.go`
- Wysyłka idzie przez **Resend** (lub SMTP), patrz `docs/EMAIL_VPS_SETUP.md`. Adres nadawcy: `MARKETING_EMAIL_FROM` lub `SMTP_FROM` (domena zweryfikowana u dostawcy).

## Zmienne

Składnia: `{{nazwa}}` — w nazwie dozwolone litery, cyfry i podkreślenie (np. `{{firstName}}`, `{{unsubscribeUrl}}`).

Slug szablonu w env (np. `WINBACK_TEMPLATE_SLUG`) musi **dokładnie** odpowiadać polu `Slug` w `marketing_templates_data.go` (tylko `a-z`, `0-9`, `-`).

## Aktualne slugi

- `winback-soft` — powrót po dłuższej ciszy.
- `social-proof-drop` — powrót do treści, które znowu są popularne.
- `repeat-buyer-10` — jednorazowy kod dla osób, które już kupowały.
- `favorite-nudge` — jednorazowy mail po pierwszym dodaniu do ulubionych.
- `welcome-value-stack` — pierwszy marketingowy mail po weryfikacji e-mail (value stack, PG-safe).
- `starter-offer-welcome` — okno startowe dla zweryfikowanych bez zakupu (cron).
- `at-risk-retention` — kupujący, krótsza cisza (cron).
- `lapsed-buyer-comeback` — kupujący, głębsza cisza przed winbackiem (cron).
- `catalog-model-updated` i `promo-limited` — szablony pomocnicze do ręcznych lub przyszłych kampanii.

Szablony **transakcyjne** (weryfikacja, reset, potwierdzenie płatności, odrzucenie wpłaty, porzucony checkout) są w `backend/internal/mailer/mailer.go` + `transactional_html.go` (wspólna rama HTML).

## Dobre praktyki

- Link **wypisu**: zawsze `{{unsubscribeUrl}}` (generowany przez backend).
- Zgoda: `users.marketing_email_opt_in` (patrz `MARKETING_CAMPAIGNS.md`).
- Nadawca promocji: rozważ `newsletter@…` zamiast `noreply@…`; adres musi być dozwolony w Resend.
- Wysyłaj z ciepłego, rozpoznawalnego nadawcy i trzymaj jeden główny CTA. Szablony są celowo krótkie, bo mają kierować do katalogu, nie sprzedawać całej oferty w e-mailu.

## Dodawanie nowego szablonu

1. Dodaj wpis do slice `embeddedMarketingTemplates` w `marketing_templates_data.go`.
2. Upewnij się, że kampania w `internal/marketing/campaigns/` przekazuje wszystkie wymagane zmienne (porównaj z `MarketingTemplateVariableNames`).
3. Ustaw odpowiedni `*_TEMPLATE_SLUG` w `.env`.
