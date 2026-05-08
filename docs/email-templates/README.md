# Szablony HTML e-mail Dyskiof

Szablony w stylu Dyskiof (ciemny motyw, fiolet `#7c3aed`) — używane jako inspiracja / kopiowanie fragmentów do treści generowanych przez backend (`backend/internal/mailer`).

## Użycie

Backend składa HTML w Go (`SendVerificationEmail`, `SendPasswordReset`, itd.). Te pliki w `docs/email-templates/` służą do wizualnej spójności i ręcznych testów w kliencie pocztowym.

## Placeholdery

Szablony mogą zawierać placeholdery typu `{{VERIFY_URL}}` — w kodzie produkcyjnym zamieniane są na wartości z Go (`fmt.Sprintf`).
