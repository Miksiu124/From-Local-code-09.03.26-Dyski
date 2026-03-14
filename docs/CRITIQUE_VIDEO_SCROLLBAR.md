# Design Critique — Horizontal Scrollbar Below Video Player

**Date:** March 14, 2026  
**Scope:** Content viewer page (video player layout)  
**Issue:** Horizontal scrollbar visible below the video player

---

## Anti-Patterns Verdict

**PASS** (for this specific issue). The scrollbar is a layout bug, not an AI slop tell. The video player UI itself (controls, progress bar, navigation) is functional and reasonably designed.

---

## Overall Impression

The horizontal scrollbar below the player is a **layout containment failure**. It signals that something inside or around the player is wider than its container, and the overflow is leaking to the page. It breaks the illusion of a contained, polished media experience and makes the interface feel unfinished.

---

## What's Working

1. **Video controls** — Play/pause, volume, progress bar, quality, fullscreen are clearly laid out. The controls row is intentionally scrollable on mobile (with scrollbar hidden) when buttons overflow.
2. **Navigation affordance** — "Swift + strzałki do nawigacji" and swipe hints communicate how to move between items.
3. **Touch targets** — 48px minimum on mobile for seek/play aligns with accessibility guidelines.

---

## Priority Issues

### 1. Horizontal overflow leaking to page (CRITICAL)

**What:** A horizontal scrollbar appears below the video player, indicating content is wider than the viewport.

**Why it matters:**  
- Breaks visual containment — the player should feel like a contained media block, not a leaky box  
- Suggests layout bugs; users may try to scroll sideways and find nothing useful  
- Hurts perceived polish and trust  
- On mobile, horizontal scrollbars are especially jarring and often indicate a broken responsive layout  

**Root cause (technical):**  
- Flex children without `min-w-0` can refuse to shrink below their content’s intrinsic width  
- The video player wrapper (`w-full max-w-6xl`) or the video element may be inheriting a minimum width from the video’s dimensions or from flex defaults  
- Portrait videos in a 16:9 container can trigger layout quirks if the video element isn’t explicitly constrained  

**Fix:**  
- Add `min-w-0` to the flex child chain (player wrapper, VideoPlayer root) so flex items can shrink  
- Add `overflow-x-hidden` to the content-viewer wrapper to prevent horizontal scrollbar from appearing  
- Ensure the video element has `object-contain` so portrait content fits without forcing width  

**Command:** `/adapt` (responsive/layout) or direct fix by senior developer  

---

### 2. Controls row scrollbar visibility (if applicable)

**What:** The controls row uses `overflow-x-auto` with scrollbar hidden. If the visible scrollbar is actually from this row (e.g. on some browsers where hiding fails), it would appear “below” the progress bar.

**Why it matters:**  
- Inconsistent behavior across browsers (WebKit vs Firefox vs others)  
- Users may not realize the controls are scrollable  

**Fix:**  
- Confirm the scrollbar is from the page, not the controls row  
- If from controls: ensure `scrollbar-width: none` and `::-webkit-scrollbar { display: none }` are applied correctly; consider `overflow-x: hidden` with a different layout (e.g. wrap controls) if horizontal scroll isn’t essential  

**Command:** `/adapt`, `/polish`  

---

### 3. Portrait video in landscape container

**What:** Selfie/portrait videos are shown in an `aspect-video` (16:9) container. The video may not have `object-contain`, leading to unexpected sizing.

**Why it matters:**  
- Portrait content in a landscape box can cause overflow or odd letterboxing if sizing isn’t explicit  
- Can contribute to the horizontal overflow issue  

**Fix:**  
- Add `object-contain` to the video element so it scales to fit without overflowing  

**Command:** `/adapt`  

---

## Minor Observations

- The hint text "Swift + strzałki do nawigacji" is very small (`text-[10px]` on mobile); consider `text-xs` minimum for readability.
- The back link shows "Back" on mobile — good truncation for small screens.

---

## Questions to Consider

- Does the controls row need to scroll horizontally on mobile, or could a more compact layout (e.g. icon-only, collapsible quality) avoid overflow?
- Should portrait videos use a different aspect-ratio container (e.g. 9:16) instead of forcing 16:9?
