# Load test — symulacja wielu równoczesnych streamów

Test obciążenia przy 100+ równoczesnych odtwarzaniach wideo.

## Przygotowanie

1. Zaloguj się na https://dyskiof.net
2. Otwórz film (do którego masz dostęp)
3. **Session cookie:** DevTools (F12) → Application → Cookies → `session_token` → skopiuj wartość
4. **Content ID:** z URL strony `/content/UUID` — skopiuj UUID

## Opcja 1: Python (prosty)

```bash
pip install requests
python scripts/load-test-streams.py \
  --cookie "WARTOSC_SESSION_TOKEN" \
  --content-id "uuid-filmu" \
  --streams 100 \
  --duration 60
```

| Parametr | Domyślnie | Opis |
|----------|-----------|------|
| `--streams` | 100 | Liczba równoczesnych „streamów” |
| `--duration` | 60 | Czas testu w sekundach |

## Opcja 2: k6 (bardziej zaawansowane)

```bash
# Zainstaluj k6: https://k6.io/docs/getting-started/installation/
k6 run \
  -e SESSION="WARTOSC_SESSION_TOKEN" \
  -e CONTENT_ID="uuid-filmu" \
  -e VUS=100 \
  -e DURATION=60 \
  scripts/load-test-streams-k6.js
```

## Monitorowanie VPS

Na VPS w drugim terminalu:

```bash
ssh deploy@138.249.138.60
docker stats
# lub
htop
```

## Interpretacja

- **CPU 30–50%** — normalne przy starcie/zmianie jakości
- **CPU >80%** — rozważ cache playlist lub upgrade VPS
- **Błędy 429** — rate limiting (nginx lub API)
- **Błędy 502/503** — przeciążenie, API nie nadąża
