# Publikacja na GitHub — Działająca strona na VPS - Dyskiof.net

Instrukcja dodania projektu do nowego repozytorium GitHub.

---

## 1. Utwórz nowe repozytorium na GitHub

1. Wejdź na [github.com/new](https://github.com/new)
2. **Repository name:** `Dzialajaca-strona-na-VPS---Dyskiof.net`  
   (GitHub zamienia spacje na myślniki; możesz też użyć: `dyskiof-net-vps`)
3. **Description:** `Działająca strona Dyskiof.net na VPS — Next.js, Go, PostgreSQL, Redis, Docker`
4. Ustaw **Private** (jeśli projekt ma być prywatny)
5. **Nie** zaznaczaj "Add a README" — repozytorium już ma README
6. Kliknij **Create repository**

---

## 2. Dodaj remote i wypchnij kod

W katalogu projektu (`ContentManager`):

```bash
cd "g:\Website tinkering bezs vue\ContentManager"

# Dodaj nowy remote (zamień YOUR_USERNAME na swoją nazwę użytkownika GitHub)
git remote add dyskiof https://github.com/YOUR_USERNAME/Dzialajaca-strona-na-VPS---Dyskiof.net.git

# Wypchnij aktualną gałąź (np. v2-development lub main)
git push -u dyskiof v2-development:main
```

Jeśli chcesz wypchnąć inną gałąź jako `main`:

```bash
git push -u dyskiof security/hardening-feb2025:main
# lub
git push -u dyskiof backup/current-state-2025-02:main
```

---

## 3. Weryfikacja

- Otwórz repozytorium w przeglądarce
- Sprawdź, czy README wyświetla się poprawnie
- Upewnij się, że `.env` **nie** jest w repozytorium (jest w `.gitignore`)

---

## Uwagi

- **Origin** nadal wskazuje na `ContentManager` — możesz go zachować do synchronizacji z oryginalnym projektem
- **Dyskiof** to nowy remote tylko do publikacji wersji VPS
- Przed push upewnij się, że nie commitujesz `.env`, `node_modules`, `.next` ani innych wrażliwych plików
