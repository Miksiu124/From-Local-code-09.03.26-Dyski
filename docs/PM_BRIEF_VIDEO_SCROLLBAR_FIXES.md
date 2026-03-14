# Senior Product Manager — Video Scrollbar Fixes

**Date:** March 14, 2026  
**Source:** [CRITIQUE_VIDEO_SCROLLBAR.md](./CRITIQUE_VIDEO_SCROLLBAR.md)  
**Assignee:** Senior Developer

---

## Status Overview

| Issue | Priority | Status | Notes |
|-------|----------|--------|------|
| 1. Horizontal overflow leaking to page | CRITICAL | ✅ Done | `min-w-0`, `overflow-x-hidden`, `object-contain` applied |
| 2. Controls row scrollbar visibility | High | ✅ Done | `.scrollbar-hide` utility in globals.css; applied to controls row |
| 3. Portrait video in landscape container | High | ✅ Done | `object-contain` on video element |
| 4. Hint text too small on mobile | Minor | ✅ Done | `text-[10px]` → `text-xs` in content-viewer + model-detail |

---

## Instructions for Senior Developer

### Task 1: Verify controls row scrollbar (Issue 2)

**Location:** `video-player.tsx` — controls row (line ~744)

**Current:** `[scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden`

**Action:**
- Test in Firefox, Chrome, Edge, Safari (desktop + mobile)
- If any browser still shows a horizontal scrollbar from the controls row:
  - Ensure `scrollbar-width: none` and `-ms-overflow-style: none` are applied
  - For WebKit: use `[&::-webkit-scrollbar]:{display:none}` or add a global utility if Tailwind variant fails
- If scrollbar persists and horizontal scroll isn’t essential on mobile: consider `overflow-x-hidden` and a more compact controls layout (e.g. icon-only quality, wrap)

---

### Task 2: Increase hint text size (Minor)

**Location:** `content-viewer.tsx` line ~367; `model-detail.tsx` line ~1118

**Current:** `text-[10px] sm:text-xs`

**Action:** Change to `text-xs` so the hint ("Swift + strzałki do nawigacji" / "Swipe to navigate") meets minimum readability on mobile.

---

### Task 3: Regression check

After changes:
- Confirm no horizontal scrollbar on content viewer page (video + photo)
- Confirm no horizontal scrollbar on model-detail overlay (video + photo)
- Confirm portrait videos display correctly with letterboxing (no overflow)

---

## Definition of Done

- [x] Controls row scrollbar verified or fixed across major browsers
- [x] Hint text uses `text-xs` minimum
- [x] No horizontal scrollbar on video/content viewer pages
- [x] Build passes
