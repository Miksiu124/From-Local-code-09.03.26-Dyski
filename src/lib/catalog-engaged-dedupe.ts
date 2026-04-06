/**
 * One catalog_model_engaged_impression per browser tab per model (sessionStorage).
 */
const STORAGE_KEY = "gf_catalog_engaged_v1";

export function tryConsumeCatalogEngagedSlot(modelId: string): boolean {
  if (typeof window === "undefined" || !modelId) return false;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const arr: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    if (arr.includes(modelId)) return false;
    arr.push(modelId);
    if (arr.length > 6000) arr.splice(0, arr.length - 6000);
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
    return true;
  } catch {
    return true;
  }
}
