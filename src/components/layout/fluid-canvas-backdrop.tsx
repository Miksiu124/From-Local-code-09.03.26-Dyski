/**
 * Ambient page background — CSS-only (no canvas / RAF).
 * The previous canvas implementation animated full-viewport gradients every frame (~60fps),
 * which competes with scrolling and layout on low-end devices.
 */
export function FluidCanvasBackdrop() {
  return (
    <div
      className="pointer-events-none fixed inset-0 z-0 hero-gradient"
      aria-hidden
    />
  );
}
