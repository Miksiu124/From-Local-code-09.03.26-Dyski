# Publikacja na GitHub — Działająca strona na VPS - Dyskiof.net

Repozytorium zostało utworzone i wypchnięte.

---

## Repozytorium

**URL:** https://github.com/Miksiu124/Dzialajaca-strona-na-VPS-Dyskiof-net

- **Remote:** `dyskiof`
- **Gałąź główna:** `main` (wypchnięta z `backup/current-state-2025-02`)

---

## Dalsze wypychanie zmian

```bash
cd "g:\Website tinkering bezs vue\ContentManager"

# Wypchnij na main
git push dyskiof backup/current-state-2025-02:main

# Lub ustaw tracking
git push -u dyskiof backup/current-state-2025-02:main
```

---

## Uwagi

- **Origin** nadal wskazuje na `ContentManager` — synchronizacja z oryginalnym projektem
- **Dyskiof** — remote do publikacji wersji VPS
- Przed push upewnij się, że nie commitujesz `.env`, `node_modules`, `.next` ani innych wrażliwych plików
