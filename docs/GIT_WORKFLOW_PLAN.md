# Plan workflow Git — commitowanie zmian i organizacja gałęzi

> **Data:** 2026-03-14  
> **Cel:** Bezpiecznie zacommitować obecne zmiany, uporządkować gałęzie i ustalić prosty workflow.

---

## 1. Stan obecny

### Gałąź robocza
- **backup/current-state-2025-02** — tu są wszystkie zmiany

### Zmiany do zacommitowania
| Typ | Liczba | Przykłady |
|-----|--------|-----------|
| **Zmodyfikowane** | 33 pliki | backend, frontend, migracje, config |
| **Nowe (untracked)** | 28 plików | docs, migracje, komponenty referral, testy |

### Grupy zmian (do logicznych commitów)
1. **Referral** — logika referralów, cookie, redirect na home
2. **Custom links** — admin custom links, śledzenie konwersji
3. **Audit & security** — audyty, optymalizacje DB, rate limit
4. **Docs** — dokumentacja (audyty, plany, mockupy)
5. **Misc** — CI, README, og-image, skrypty migracji

---

## 2. Rekomendowana strategia gałęzi

```
main                    ← produkcja (VPS deploy z tej gałęzi)
  │
  └── backup/current-state-2025-02   ← Twoja aktualna gałąź robocza
        │
        └── feature/*   ← nowe featury (opcjonalnie)
```

**Zasady:**
- **main** = stabilna wersja na produkcji
- **backup/current-state-2025-02** = gałąź robocza (lub zmień nazwę na `develop`)
- Feature branches tylko przy większych zmianach (np. `feature/referral-home-redirect`)

---

## 3. Plan commitów (krok po kroku)

### Krok 0: Backup (opcjonalnie)
```powershell
cd "g:\Website tinkering bezs vue\ContentManager"
git stash push -u -m "backup-before-commit-plan"   # zapisz wszystko na stos
# Jeśli coś pójdzie nie tak: git stash pop
```

### Krok 1: Migracje
```powershell
git add backend/migrations/
git commit -m "db: add referral link tracking, audit optimizations, content_items index"
```

### Krok 2: Referral (backend + frontend)
```powershell
git add backend/internal/referral/handler.go
git add backend/internal/auth/handler.go backend/internal/auth/service.go
git add src/app/r/ src/components/referral-cookie-provider.tsx
git add src/lib/referral-cookie.ts src/lib/referral-cookie.test.ts
git add src/app/(auth)/register/page.tsx src/components/user/referral-panel.tsx
git add src/messages/en.json src/messages/pl.json
git add src/components/providers.tsx
git commit -m "feat(referral): redirect to home, cookie persistence, anti-gaming, backend redirect"
```

### Krok 3: Custom links
```powershell
git add backend/internal/admin/custom_links.go backend/internal/admin/handler.go
git add backend/internal/links/handler.go
git add src/app/(admin)/admin/custom-links/page.tsx src/components/admin/custom-links-client.tsx
git add src/lib/admin-api.ts
git commit -m "feat(admin): custom links with conversion tracking"
```

### Krok 4: Admin & content
```powershell
git add backend/internal/content/
git add backend/internal/credits/handler.go backend/internal/models/handler.go
git add src/app/(admin)/admin/analytics/page.tsx src/app/(admin)/admin/models/page.tsx
git add src/app/(user)/models/[slug]/page.tsx src/components/user/model-detail.tsx
git add src/components/user/models-grid.tsx src/components/admin/admin-sidebar.tsx
git commit -m "feat: admin analytics, content handlers, model stats"
```

### Krok 5: Auth & rate limit
```powershell
git add backend/cmd/server/main.go backend/internal/auth/handler.go
git add src/app/(auth)/login/page.tsx src/app/(auth)/register/page.tsx
git add src/lib/rate-limit.ts src/lib/rate-limit.test.ts
git add src/components/access-required-popup.tsx
git add src/middleware.test.ts
git commit -m "fix: auth flow, rate limiting, middleware tests"
```

### Krok 6: Prisma, package, CI
```powershell
git add prisma/schema.prisma package.json package-lock.json
git add .github/workflows/tests.yml vitest.config.ts
git add src/app/layout.tsx
git commit -m "chore: prisma schema, deps, CI workflow, layout"
```

### Krok 7: Skrypty
```powershell
git add scripts/run-pending-migrations.ps1 scripts/run-pending-migrations.sh
git add scripts/clear-rate-limit.sh scripts/load-test-streams-k6.js
# scripts/rename-r2-source-photos.py — opcjonalnie (jeśli potrzebny)
git commit -m "chore: migration scripts, rate limit clear, load test"
```

### Krok 8: Docs
```powershell
git add docs/
git add AUDIT_REPORT.md
git commit -m "docs: audits, referral plans, security, SEO, UX"
```

### Krok 9: Public assets
```powershell
git add public/og-image.png
git commit -m "chore: add og-image.png"
```

### Krok 10: API legacy (jeśli src/api/ to stary kod do usunięcia — sprawdź)
```powershell
# Sprawdź zawartość: ls src/api/
# Jeśli to api_legacy lub nieużywane — możesz pominąć lub dodać osobno
git add src/api/   # tylko jeśli to potrzebny kod
# LUB: dodaj src/api/ do .gitignore jeśli nie chcesz go w repo
```

### Krok 11: README
```powershell
git add README.md
git commit -m "docs: update README"
```

---

## 4. Push i merge do main

```powershell
# Push gałęzi roboczej
git push origin backup/current-state-2025-02

# Merge do main (lokalnie)
git checkout main
git pull origin main
git merge backup/current-state-2025-02 -m "Merge: referral, custom links, audits, migrations"
git push origin main
```

---

## 5. Opcjonalnie: remote dyskiof

Jeśli chcesz osobne repo dla wersji produkcyjnej (jak w GITHUB_SETUP.md):

```powershell
git remote add dyskiof https://github.com/Miksiu124/Dzialajaca-strona-na-VPS-Dyskiof-net
git push dyskiof main:main
```

---

## 6. Szybka ścieżka (jeden commit)

Jeśli wolisz jeden duży commit zamiast wielu małych:

```powershell
cd "g:\Website tinkering bezs vue\ContentManager"
git add -A
git status   # sprawdź, czy .env nie jest na liście!
git commit -m "feat: referral (home redirect, cookie), custom links, audits, migrations, docs"
git push origin backup/current-state-2025-02
```

**Uwaga:** Przed `git add -A` upewnij się, że `.env` jest w `.gitignore` (już jest). `git status` nie powinien pokazywać `.env`.

---

## 7. Checklist przed pierwszym commitem

- [ ] `.env` nie jest śledzony (`git status` nie pokazuje `.env`)
- [ ] `npm test` przechodzi
- [ ] Deploy na VPS działa (już sprawdzone)
- [ ] Wybrana ścieżka: wiele commitów vs jeden duży

---

## 8. Dalsze kroki (po tym planie)

1. **Ustal nazwę gałęzi roboczej** — `develop` zamiast `backup/current-state-2025-02`?
2. **Deploy z main** — rozważ zmianę skryptu deploy, żeby VPS robił `git pull origin main` zamiast rsync z lokalnej maszyny.
3. **PR przed merge** — jeśli pracujesz w zespole, wymagaj PR przed merge do main.
