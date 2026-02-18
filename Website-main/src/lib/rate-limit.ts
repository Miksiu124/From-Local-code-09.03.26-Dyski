import { getOptionalEnv } from "@/lib/env";
import type { Ratelimit } from "@upstash/ratelimit";

// ── Types ────────────────────────────────────────────────────────────────────

type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  limit: number;
};

// ── Config ───────────────────────────────────────────────────────────────────

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_LIMIT = 120;

// ── Upstash-backed limiter (preferred) ───────────────────────────────────────

let upstashRatelimit: Ratelimit | null = null;
let upstashReady = false;

async function getUpstashLimiter() {
  if (upstashReady) return upstashRatelimit;
  upstashReady = true;

  const url = getOptionalEnv("UPSTASH_REDIS_REST_URL");
  const token = getOptionalEnv("UPSTASH_REDIS_REST_TOKEN");
  if (!url || !token) return null;

  try {
    const { Ratelimit } = await import("@upstash/ratelimit");
    const { Redis } = await import("@upstash/redis");

    const redis = new Redis({ url, token });
    upstashRatelimit = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(DEFAULT_LIMIT, `${DEFAULT_WINDOW_MS / 1000} s`),
      analytics: true,
      prefix: "ratelimit",
    });
    return upstashRatelimit;
  } catch {
    return null;
  }
}

// ── In-memory fallback (bounded) ─────────────────────────────────────────────

const MAX_STORE_SIZE = 50_000;

type RateLimitEntry = { count: number; resetAt: number };

function getStore() {
  const g = globalThis as typeof globalThis & {
    __rateLimitStore?: Map<string, RateLimitEntry>;
  };
  if (!g.__rateLimitStore) g.__rateLimitStore = new Map();
  return g.__rateLimitStore;
}

/** Evict expired entries; if still over budget, drop oldest 20%. */
function evictIfNeeded(store: Map<string, RateLimitEntry>) {
  if (store.size < MAX_STORE_SIZE) return;
  const now = Date.now();
  // Pass 1: remove expired
  for (const [k, v] of store) {
    if (v.resetAt <= now) store.delete(k);
  }
  // Pass 2: if still too big, remove oldest entries
  if (store.size >= MAX_STORE_SIZE) {
    const toDelete = Math.max(1, Math.floor(store.size * 0.2));
    let deleted = 0;
    for (const k of store.keys()) {
      if (deleted >= toDelete) break;
      store.delete(k);
      deleted++;
    }
  }
}

function checkInMemory(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  const store = getStore();
  evictIfNeeded(store);
  const existing = store.get(key);

  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowMs;
    store.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: limit - 1, resetAt, limit };
  }

  if (existing.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt, limit };
  }

  existing.count += 1;
  store.set(key, existing);
  return {
    allowed: true,
    remaining: Math.max(0, limit - existing.count),
    resetAt: existing.resetAt,
    limit,
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function checkRateLimit(
  key: string,
  limit: number = DEFAULT_LIMIT,
  windowMs: number = DEFAULT_WINDOW_MS
): Promise<RateLimitResult> {
  const upstash = await getUpstashLimiter();

  if (upstash) {
    try {
      const { success, remaining, reset } = await upstash.limit(key);
      return {
        allowed: success,
        remaining,
        resetAt: reset,
        limit,
      };
    } catch {
      // Fall back to in-memory if Upstash call fails
    }
  }

  return checkInMemory(key, limit, windowMs);
}
