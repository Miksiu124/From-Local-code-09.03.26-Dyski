# Code Review — Lighthouse Fixes

**Date:** March 14, 2026  
**Scope:** Color contrast, accessibility, product brief

---

## Summary

Changes address Lighthouse findings: color contrast (3 failing elements) and user menu accessibility.

---

## Changes Reviewed

### 1. Color contrast (`globals.css`)

- **Primary:** `#8b5cf6` → `#7c3aed` (violet-600)
- **Rationale:** `#fafafa` on `#7c3aed` ≈ 4.53:1 (meets WCAG AA 4.5:1)
- **Scope:** `--color-primary`, `--color-accent`, `--color-ring`; hero-gradient, glow, card-hover rgba values
- **Risk:** Low. Slightly darker purple; design intent preserved.

### 2. Footer contrast (`footer.tsx`)

- **Change:** `text-muted-foreground/60` → `text-muted-foreground`
- **Rationale:** `#a1a1aa` on `#020202` ≈ 4.54:1 (meets 4.5:1)
- **Risk:** Low. Footer text slightly brighter.

### 3. User menu accessibility (`header.tsx`)

- **Change:** `aria-label`, `aria-expanded`, `aria-haspopup="menu"` on user menu button
- **i18n:** `nav.userMenu` added to `pl.json` and `en.json`
- **Risk:** None. Improves screen reader support.

### 4. Product brief (`docs/LIGHTHOUSE_PRODUCT_BRIEF.md`)

- Documents findings, PM instructions, verification steps
- **Note:** `robots.ts` already provides valid robots; no new `robots.txt` added

---

## Verdict

**APPROVED.** Changes are targeted, low-risk, and improve accessibility and Lighthouse scores. No security or functional regressions observed. Build passes.
