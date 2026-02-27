import { db } from "./db";

// ── TTL + LRU-bounded Cache ──────────────────────────────────────────────────

const ACCESS_CACHE_TTL_MS = 60_000; // 60 seconds
const ACCESS_CACHE_MAX_SIZE = 10_000;

type CacheEntry<T> = { value: T; expiresAt: number };

function getAccessCache() {
  const g = globalThis as typeof globalThis & {
    __accessCache?: Map<string, CacheEntry<boolean>>;
  };
  if (!g.__accessCache) g.__accessCache = new Map();
  return g.__accessCache;
}

function getCached(key: string): boolean | undefined {
  const cache = getAccessCache();
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  // Move to end (most recently used) — Map preserves insertion order
  cache.delete(key);
  cache.set(key, entry);
  return entry.value;
}

function setCache(key: string, value: boolean) {
  const cache = getAccessCache();
  // Evict oldest entries if at capacity
  if (cache.size >= ACCESS_CACHE_MAX_SIZE) {
    // Delete the first (oldest) 10% of entries
    const toDelete = Math.max(1, Math.floor(ACCESS_CACHE_MAX_SIZE * 0.1));
    let deleted = 0;
    for (const k of cache.keys()) {
      if (deleted >= toDelete) break;
      cache.delete(k);
      deleted++;
    }
  }
  cache.set(key, { value, expiresAt: Date.now() + ACCESS_CACHE_TTL_MS });
}

/** Evict a specific user's cached access (call after granting / revoking) */
export function invalidateAccessCache(userId: string) {
  const cache = getAccessCache();
  for (const key of cache.keys()) {
    if (key.startsWith(`${userId}:`)) cache.delete(key);
  }
}

// ── Access helpers ───────────────────────────────────────────────────────────

/**
 * Check if a user has access to a specific model.
 * Access is granted if:
 * 1. User has a direct UserAccess for this model (individual purchase, not expired)
 * 2. User has a bundle UserAccess (modelId = null, meaning all models)
 */
export async function canAccessModel(userId: string, modelId: string): Promise<boolean> {
  const cacheKey = `${userId}:model:${modelId}`;
  const cached = getCached(cacheKey);
  if (cached !== undefined) return cached;

  const access = await db.userAccess.findFirst({
    where: {
      userId,
      AND: [
        {
          OR: [
            { modelId }, // Direct model access
            { modelId: null }, // Bundle access (all models)
          ],
        },
        {
          OR: [
            { expiresAt: null }, // Legacy records without expiration
            { expiresAt: { gt: new Date() } }, // Not expired
          ],
        },
      ],
    },
  });

  const result = !!access;
  setCache(cacheKey, result);
  return result;
}

/**
 * Check if a user has access to a content item by checking the parent model.
 */
export async function canAccessContent(userId: string, contentItemId: string): Promise<boolean> {
  const contentItem = await db.contentItem.findUnique({
    where: { id: contentItemId },
    select: { modelId: true },
  });

  if (!contentItem) return false;

  return canAccessModel(userId, contentItem.modelId);
}

/**
 * Check if a user has bundle access (all models).
 */
export async function hasBundleAccess(userId: string): Promise<boolean> {
  const cacheKey = `${userId}:bundle`;
  const cached = getCached(cacheKey);
  if (cached !== undefined) return cached;

  const access = await db.userAccess.findFirst({
    where: {
      userId,
      modelId: null,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    },
  });

  const result = !!access;
  setCache(cacheKey, result);
  return result;
}

/**
 * Get all model IDs a user has access to.
 */
export async function getUserAccessibleModelIds(userId: string): Promise<string[] | "all"> {
  // Check for bundle access first
  const hasBundle = await hasBundleAccess(userId);
  if (hasBundle) return "all";

  const accessRecords = await db.userAccess.findMany({
    where: {
      userId,
      modelId: { not: null },
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    },
    select: { modelId: true },
  });

  return accessRecords
    .filter((a: { modelId: string | null }) => a.modelId !== null)
    .map((a: { modelId: string | null }) => a.modelId as string);
}

/**
 * Get the credit cost for a model (7-day and 30-day) from settings.
 */
export async function getModelCreditCosts(): Promise<{ cost7d: number; cost30d: number }> {
  const [s7d, s30d] = await Promise.all([
    db.setting.findUnique({ where: { key: "model_credit_cost_7d" } }),
    db.setting.findUnique({ where: { key: "model_credit_cost_30d" } }),
  ]);

  return {
    cost7d: s7d ? (s7d.value as number) : 0,
    cost30d: s30d ? (s30d.value as number) : 0,
  };
}

/**
 * Get the credit costs for bundle from settings (14d and 30d).
 */
export async function getBundleCreditCosts(): Promise<{ cost14d: number; cost30d: number }> {
  const [s14d, s30d] = await Promise.all([
    db.setting.findUnique({ where: { key: "bundle_credit_cost_14d" } }),
    db.setting.findUnique({ where: { key: "bundle_credit_cost_30d" } }),
  ]);

  return {
    cost14d: s14d ? (s14d.value as number) : 0,
    cost30d: s30d ? (s30d.value as number) : 0,
  };
}
