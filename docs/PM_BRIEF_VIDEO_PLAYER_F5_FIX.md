# Senior Product Manager — Video Player Hanging After F5

**Date:** March 16, 2026  
**Assignee:** Senior Developer  
**Priority:** CRITICAL

---

## Problem Statement

The video player hangs in a loading state after the user refreshes the page (F5). Network tab shows 0 errors and successful 206 responses for video segments, but the player never reaches `canplay` and remains stuck with spinner(s).

---

## Root Cause Analysis (PM Summary)

| Area | Finding |
|------|---------|
| **F5 timing** | On full reload, playlist request competes with page load (browser connection limit). Code waits for `document.load` before init. |
| **Load event race** | If VideoPlayer mounts after `window.load` has already fired (e.g. dynamic import resolves late), we check `document.readyState === "complete"` and init. But if we see `"interactive"` and add a load listener, the load event may have *just* fired — we never get the callback and never init. |
| **Autoplay re-init** | Fixed previously: `autoplayEnabled` in effect deps caused HLS destroy/recreate when preferences loaded. |
| **No fallback** | If `canplay` never fires (codec/CORS/segment issue), loading state is infinite. Loading timeout (25s) was added. |

---

## Acceptance Criteria

- [ ] Video plays reliably after F5 on both `/content/[slug]/[id]` and overlay (`/models/[slug]?view=id`)
- [ ] No indefinite loading spinner — either video plays or user sees retry within 25s
- [ ] No regression: video still works on normal navigation (no F5)

---

## Developer Tasks

### Task 1: Fix load-event race (CRITICAL) — ✅ DONE

**Location:** `video-player.tsx` — `scheduleInit()` inside HLS init effect

**Current logic:**
```ts
if (document.readyState === "complete") {
  initHls();
} else {
  loadHandler = () => initHls();
  window.addEventListener("load", loadHandler);
}
```

**Bug:** If we add the listener when `readyState === "interactive"`, the `load` event may have already fired. We never get the callback → HLS never initializes → player hangs.

**Fix:** After adding the listener, check again. If `document.readyState === "complete"`, remove the listener and call `initHls()` immediately.

```ts
if (document.readyState === "complete") {
  initHls();
} else {
  loadHandler = () => initHls();
  window.addEventListener("load", loadHandler);
  // Race: load may have fired between our check and addEventListener
  if (document.readyState === "complete") {
    window.removeEventListener("load", loadHandler);
    loadHandler = null;
    initHls();
  }
}
```

---

### Task 2: Defer init slightly after load (RECOMMENDED) — ✅ DONE (requestAnimationFrame)

**Rationale:** On F5, even after `load`, the browser may still be settling (connection pool, etc.). A short delay (50–100ms) can reduce flakiness.

**Action:** After `initHls()` is scheduled (either immediately or via load callback), wrap the call in `requestAnimationFrame` or `setTimeout(..., 50)` so the playlist request doesn't compete with final page teardown.

---

### Task 3: Verify existing safeguards

- [ ] Loading timeout (25s) is active and shows retry
- [ ] `autoplayEnabledRef` is used (no HLS re-init on pref load)
- [ ] Retry button works and re-initializes HLS

---

## Definition of Done

- [x] Load-event race fix applied and tested
- [x] F5 fallback: redirect to model_folder on reload (signed URLs break player after refresh)
- [x] Video player: autoplayEnabled ref (no HLS re-init on pref load), 25s loading timeout, rAF defer
- [ ] Video plays after F5 on content page (manual test) — or user is redirected
- [ ] Video plays after F5 on model overlay (?view=) (manual test) — or user is redirected
- [ ] No regression on normal navigation (manual test)
- [x] Build passes

---

## Test Procedure

1. Navigate to a video (content page or overlay)
2. Confirm video plays
3. Press F5
4. Confirm video loads and plays (or shows retry within 25s)
5. Repeat on slow 3G throttling if possible
