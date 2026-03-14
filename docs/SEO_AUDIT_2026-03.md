# SEO Audit Report — Dyskiof (ContentManager)

**Date:** March 13, 2026  
**Scope:** dyskiof.net — Premium Content Platform (Next.js)  
**Methodology:** Technical SEO audit per [seo-specialist.mdc](.cursor/rules/seo-specialist.mdc) framework

---

## Executive Summary

The site has a solid technical foundation: metadata, robots.txt, sitemap, and WebSite schema are in place. Several high-impact improvements remain—especially Open Graph images, per-page canonicals, richer schema, and image alt text—that can improve visibility and social sharing.

---

## 1. Crawlability & Indexation

### Robots.txt ✅
- **Location:** `/robots.txt` (Next.js dynamic)
- **Allowed:** `/` (all public paths)
- **Disallowed:** `/admin/`, `/api/`, `/dashboard`, `/my-purchases`, `/favorites`
- **Sitemap:** Declared correctly (`{baseUrl}/sitemap.xml`)

**Recommendation:** Consider adding `/login`, `/register`, `/purchase` to `disallow` if you prefer these not to be indexed (they are in the sitemap but may be low-value for organic search). Alternatively, keep them indexable for branded queries like "Dyskiof login."

### XML Sitemap ✅
- **Static pages:** Homepage, login, register, purchase
- **Dynamic pages:** Model pages (`/models/{folderName}`) from API (limit 500)
- **Change frequency:** Homepage daily, models weekly, auth monthly
- **Priority:** Homepage 1.0, models 0.8, purchase 0.7, auth 0.3

**Issues:**
1. **500-model cap** — If you have >500 models, some pages won’t be in the sitemap. Consider pagination or higher limit.
2. **Missing pages:** `/models` redirects to `/` — OK. `/content/{slug}/{id}` is behind auth and not in sitemap — correct.
3. **`lastModified`** — Only homepage and models have it; login/register/purchase do not. Add for consistency.

---

## 2. Meta Tags & On-Page SEO

### Root Layout (layout.tsx)

| Element | Current | Target | Status |
|---------|---------|--------|--------|
| Title | "Dyskiof – Premium Content Platform" | 50–60 chars | ✅ ~38 chars |
| Meta description | ~95 chars | 150–160 chars | ⚠️ Short |
| Keywords | Present | Optional (low impact) | ✅ |
| Canonical | `baseUrl` only | Per-page | ⚠️ See below |
| og:title | Set | — | ✅ |
| og:description | Set | — | ✅ |
| **og:image** | **Missing** | 1200×630 px | ❌ Critical |
| og:url | Set | — | ✅ |
| twitter:card | summary_large_image | — | ✅ |
| twitter:title | Set | — | ✅ |
| twitter:description | Set | — | ✅ |
| **twitter:image** | **Missing** | — | ❌ |

### Model Pages (generateMetadata)

| Element | Current | Status |
|---------|---------|--------|
| Title | `{model.name}` | ⚠️ No brand suffix (template may add it) |
| Description | Model description or fallback | ✅ |
| og:title | `{model.name} \| Dyskiof` | ✅ |
| og:url | Set | ✅ |
| **og:image** | **Missing** | ❌ Use model avatar/header |
| **Canonical** | **Missing** | ❌ Needed for filter/sort variants |

### Canonical & Duplicate Content

Model pages support `?sort=newest|oldest|longest|shortest` and `?filter=VIDEO|PHOTO`. These create multiple URLs for the same page:

- `/models/jane-doe`
- `/models/jane-doe?sort=oldest`
- `/models/jane-doe?filter=VIDEO`

**Recommendation:** Add a self-referencing canonical to the base URL (e.g. `/models/jane-doe`) in `generateMetadata` for model pages. This tells search engines to treat filter/sort variants as the same page.

### Pages Without Custom Metadata

- **Homepage** — Uses root metadata ✅
- **Login, Register** — Use root metadata ⚠️ Consider custom titles for branded queries
- **Purchase** — Uses root metadata ⚠️ Consider "Buy Credits \| Dyskiof"
- **Dashboard, Favorites, My Purchases** — Use root metadata; these are behind auth and may be noindexed
- **Content viewer** — No metadata; behind auth, not critical

---

## 3. Structured Data (Schema)

### Current Implementation ✅
- **WebSite** schema in layout:
  - `@type`: WebSite
  - `name`, `url`, `description`
  - `SearchAction` with `{search_term_string}` placeholder

### Missing Opportunities

1. **Organization schema** — Add `Organization` with name, url, logo for brand/knowledge panel.
2. **BreadcrumbList** — Add on model pages: Home → Models → {Model Name}.
3. **Person/Creator schema** — On model pages, add `Person` or `ProfilePage` for creator identity (supports E-E-A-T).
4. **ImageObject** — For og:image, consider `ImageObject` with dimensions.

---

## 4. International SEO (i18n)

- **Locales:** `en`, `pl` (cookie + Accept-Language)
- **alternates.languages:** `en` and `pl` both point to `baseUrl`
- **hreflang:** Not implemented — both locales share the same URL

**Recommendation:** If you use path-based locales (e.g. `/en/`, `/pl/`) or subdomains, add proper hreflang. With cookie-based locale and a single URL, hreflang is less critical, but you could add `x-default` and language alternates if you introduce locale-specific URLs later.

---

## 5. Images & Media

### Alt Text Audit

| Location | Current | Recommendation |
|----------|---------|----------------|
| Hero/header images (models-grid) | `alt={heroModel.name}` | ✅ Good |
| Model avatars (models-grid) | `alt={model.name}` | ✅ Good |
| Content thumbnails (model-detail) | `alt=""` | ⚠️ Use descriptive alt, e.g. "Video thumbnail: {modelName} - {contentType}" |
| Content thumbnails (favorites-grid) | `alt=""` | ⚠️ Same |
| Content viewer | `alt=""` | ⚠️ Same |
| Video player icons | `alt=""` | ✅ Decorative, OK |
| Admin proof images | `alt={t("viewProof")}` | ✅ OK |

**Recommendation:** Add descriptive alt text to content thumbnails where you have model name and content type. Empty alt is acceptable only for purely decorative images.

### Image Optimization ✅
- Next.js `Image` with AVIF/WebP
- Remote patterns for R2
- 24h cache TTL

---

## 6. Content Structure & Headings

### Homepage / Models Grid
- **H1:** "Browse Premium Content" (or similar from `t("title")`) — single H1 ✅
- **H2:** "Featured" — logical ✅
- **H3:** Model names, "Purchase Bundle" — OK

### Model Detail Page
- **H1:** `{model.name}` — single, keyword-aligned ✅
- **H3:** "Unlock Access" — OK

### Purchase Page
- **H1:** Present ✅

### Recommendation
- Ensure H1 on homepage includes primary keyword (e.g. "Premium Content" or "Exclusive Creator Content").
- Check translation keys so H1s are SEO-friendly in both EN and PL.

---

## 7. Core Web Vitals & Performance

- **Next.js:** App Router, standalone output
- **Fonts:** Outfit via `next/font` (optimized)
- **Images:** AVIF/WebP, remote patterns configured

**Recommendation:** Run Lighthouse and CrUX (Chrome User Experience) in Search Console to validate LCP, INP, CLS. The setup looks solid; verify with real data.

---

## 8. Security & SEO

- Security headers (CSP, HSTS, etc.) are configured
- No obvious conflicts with crawling or indexing

---

## Prioritized Improvement Checklist

### High Priority (Implement First)

| # | Task | File(s) | Effort |
|---|------|---------|--------|
| 1 | Add default `og:image` and `twitter:image` (1200×630) | `layout.tsx`, add `/og-image.png` to public | Low |
| 2 | Add per-page canonical for model pages (base URL without query params) | `models/[slug]/page.tsx` | Low |
| 3 | Add `og:image` for model pages (use avatar or header) | `models/[slug]/page.tsx` generateMetadata | Medium |
| 4 | Extend meta description to 150–160 chars with CTA | `layout.tsx` | Low |

### Medium Priority

| # | Task | File(s) | Effort |
|---|------|---------|--------|
| 5 | Add BreadcrumbList schema to model pages | `models/[slug]/page.tsx` | Medium |
| 6 | Add Organization schema to layout | `layout.tsx` | Low |
| 7 | Add descriptive alt text to content thumbnails | `model-detail.tsx`, `favorites-grid.tsx`, `content-viewer.tsx` | Medium |
| 8 | Add `lastModified` to all sitemap entries | `sitemap.ts` | Low |
| 9 | Review 500-model sitemap limit; add pagination if needed | `sitemap.ts` | Medium |

### Lower Priority

| # | Task | File(s) | Effort |
|---|------|---------|--------|
| 10 | Custom metadata for login, register, purchase | `login/page.tsx`, etc. | Low |
| 11 | Person/ProfilePage schema on model pages | `models/[slug]/page.tsx` | Medium |
| 12 | Hreflang if you add locale-specific URLs | `layout.tsx`, routing | High |

---

## Quick Wins (Copy-Paste Ready)

### 1. Extended meta description (layout.tsx)

```ts
description:
  "Browse exclusive premium content from top creators. Instant access, secure payments, and a curated library updated daily. Join Dyskiof today.",
```

### 2. Model page canonical (models/[slug]/page.tsx)

In `generateMetadata`, add:

```ts
alternates: {
  canonical: `${baseUrl}/models/${slug}`,
},
```

### 3. Default og:image (layout.tsx)

Add to `openGraph` and `twitter`:

```ts
openGraph: {
  // ...existing
  images: [{ url: `${baseUrl}/og-image.png`, width: 1200, height: 630, alt: "Dyskiof – Premium Content Platform" }],
},
twitter: {
  // ...existing
  images: [`${baseUrl}/og-image.png`],
},
```

Then add a 1200×630 PNG/WebP to `public/og-image.png`.

---

## Summary

| Category | Score | Notes |
|----------|-------|------|
| Crawlability | 9/10 | robots.txt, sitemap solid |
| Meta tags | 6/10 | Missing og:image, short description |
| Schema | 6/10 | WebSite present, Breadcrumb/Org missing |
| Images | 7/10 | Some empty alts, format OK |
| Content structure | 8/10 | H1/H2/H3 logical |
| i18n | 6/10 | Cookie-based, no hreflang |

**Overall:** Strong base with clear, high-impact improvements. Focus on og:image, canonicals, and schema first.
