# Dyskiof — kontekst projektowy (impeccable)

## Design Context

### Users

- **Główna grupa:** koneserzy treści z ekosystemu typu OnlyFans — znają model subskrypcji / dostępu czasowego, kredyty i „premium”, oczekują szybkiego dostępu do katalogu i zakupu.
- **Kontekst użycia:** przeglądanie i odkrywanie treści oraz finalizacja zakupu dostępu; często wieczór, urządzenie mobilne lub desktop w prywatnym ustawieniu.
- **Główne zadanie UI:** sprawnie poprowadzić od **katalogu → podgląd oferty → zakup / odblokowanie** przy minimalnym tarciu i maksymalnym „wow” na treści, nie na chrome interfejsu.

### Brand Personality

- **Trzy filary (słowa marki):** **Jakość**, **Cena**, **TOP** — komunikować „wartość za pieniądze” i selekcję wyższej półki, bez taniego chaosu wizualnego.
- **Ton emocjonalny:** **napięcie i podniecenie** — interfejs ma wspierać **pociąg seksualny** (mroczny, kontrastowy, fokus na zdjęciach/wideo), nie ton administracyjny ani „bankowy”.
- **Głos:** pewny, dorosły, bez infantylizacji; jasne CTA i ceny, bez zbędnego żargonu technicznego w ścieżce klienta.

### Aesthetic Direction

- **Motyw:** **wyłącznie dark** — spójny z kontekstem oglądania treści dla dorosłych i wieczornym użyciem.
- **Kolor i akcent:** użytkownik nie narzucił sztywnej palety (**„BEZ”** dodatkowych constraintów) — **wolno przeprojektować** tokeny (w tym odejście od domyślnego **fioletu szablonowego** / „AI SaaS”), przy zachowaniu **czytelności**, **kontrastu** i **hierarchii** na ciemnym tle.
- **Referencje / anty-referencje:** nie podano konkretnych stron — unikać wyglądu **generycznego dark + purple + gradient text + glass**; cel to **własny**, rozpoznawalny klimat „premium adult”, nie kopia OF ani szablonu z tutoriala.

### Design Principles

1. **Treść jest gwiazdą** — UI ustępuje miejsca fotografii i wideo; mniej dekoracji, więcej kontrastu i kadrowania pod media.
2. **Jakość · Cena · TOP** — każdy ekran sprzedażowy ma czytelnie komunikować **wartość** (co dostaję, za co płacę, dlaczego to „top”).
3. **Dark bez „szpitalnej” sterylności** — ciepłe lub nasycone akcenty OK, byle **nie neonowy szablon**; neutrale lekko **tintowane** pod akcent marki (preferencja OKLCH w implementacji).
4. **Napięcie, nie chaos** — hierarchia typograficzna i spacing: jeden wyraźny fokus na sekcję; unikać ściany równorzędnych przycisków i kart.
5. **Zakaz impeccable bez kompromisów:** **bez gradient text** na copy marki/nagłówkach; **bez bocznych „stripe” borderów** na kartach; **bez** dominacji glassmorphism/glow jako stylu zastępczego za koncepcję.
6. **Typografia:** para **display + body** poza listą „reflex” z skilli (obecny **Outfit** traktować jako do wymiany przy redesignie); skala **rem** w UI produktowym, czytelność na dark.
7. **Dostępność (domyślna, do potwierdzenia):** sensowne **focus states**, kontrast tekstu **≥ WCAG AA** tam gdzie to copy i kontrolki; szanować **`prefers-reduced-motion`** przy animacjach — jeśli potrzebny wyższy poziom, dopisać w tym pliku.

---

*Zaktualizowano z sesji `/impeccable teach`. Nie synchronizowano z `.github/copilot-instructions.md` (świadoma rezygnacja).*
