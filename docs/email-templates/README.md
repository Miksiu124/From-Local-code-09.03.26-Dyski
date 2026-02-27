# Szablony email ContentVault dla BillionMail

Szablony w stylu ContentVault (ciemny motyw, fiolet #7c3aed) do importu w panelu BillionMail.

## Szablony

| Plik | Nazwa | Cel |
|------|-------|-----|
| `newsletter-welcome.html` | Newsletter welcome | Powitanie nowych subskrybentów |
| `nowe-tresci.html` | Nowe treści | Informacja o nowych modelach/zdjęciach |
| `promocja.html` | Promocja | Oferty, zniżki, kody rabatowe |
| `re-engagement.html` | Re-engagement | Do użytkowników nieaktywnych |

## Jak dodać w BillionMail

1. Wejdź na panel BillionMail → **Template**
2. Kliknij **Add template** / **Create template**
3. Otwórz plik HTML (np. z tego folderu)
4. Skopiuj całą zawartość i wklej do edytora BillionMail
5. Dostosuj zmienne (placeholdery) do składni BillionMail – sprawdź w panelu, czy używa `{{VAR}}`, `{VAR}` lub innego formatu
6. Zapisz szablon

## Placeholdery (zmienne)

W szablonach używane są placeholdery – zamień je na zmienne BillionMail:

| Placeholder | Opis | Przykład |
|-------------|------|----------|
| `{{CTA_URL}}` | Link przycisku CTA | https://dyskiof.net |
| `{{UNSUBSCRIBE_URL}}` | Link do wypisania | https://dyskiof.net/unsubscribe?email=... |
| `{{CONTENT_PREVIEW}}` | Krótki opis nowych treści | "3 nowe sesje od Angeliny" |
| `{{PROMO_TITLE}}` | Tytuł promocji | "20% rabatu na kredyty" |
| `{{PROMO_DESCRIPTION}}` | Opis promocji | "Tylko do niedzieli" |
| `{{PROMO_CODE}}` | Kod rabatowy | WELCOME20 |
| `{{EXPIRY_DATE}}` | Termin ważności oferty | do 3 marca 2026 |

W BillionMail sprawdź, jaka jest składnia zmiennych (np. `{recipient.email}`, `{campaign.link}`) i dopasuj placeholdery.

## Style ContentVault

- **Tło:** #0a0a0a
- **Karta:** #171717, obramowanie rgba(255,255,255,0.06)
- **Akcent / CTA:** #7c3aed (fiolet)
- **Tekst główny:** #a3a3a3
- **Tekst mniejszy:** #737373, #525252

## Footer

Każdy szablon zawiera:
- Link do wypisania z newslettera (wymagany przy kampaniach masowych)
- Nazwę marki i domenę
