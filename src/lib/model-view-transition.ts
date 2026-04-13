/**
 * Stable CSS custom idents for View Transitions (catalog ↔ model detail).
 * - Thumb: grid cards + featured side rail (3:4 thumbnail)
 * - Header: featured hero wide image (header asset)
 */
export function modelThumbViewTransitionName(modelId: string): string {
  return `mt-${modelId.replace(/-/g, "")}`;
}

export function modelHeaderViewTransitionName(modelId: string): string {
  return `mh-${modelId.replace(/-/g, "")}`;
}
