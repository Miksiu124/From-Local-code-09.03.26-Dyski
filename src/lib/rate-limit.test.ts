import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkRateLimit } from "./rate-limit";

describe("checkRateLimit", () => {
  beforeEach(() => {
    vi.resetModules();
    // Clear in-memory store between tests by resetting the module
    const g = globalThis as typeof globalThis & { __rateLimitStore?: Map<string, unknown> };
    delete g.__rateLimitStore;
  });

  it("allows requests under the limit", async () => {
    const key = "test-ip:/api/test";
    const limit = 5;
    const windowMs = 60_000;

    for (let i = 0; i < 5; i++) {
      const result = await checkRateLimit(key, limit, windowMs);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(limit - i - 1);
    }
  });

  it("rejects requests over the limit", async () => {
    const key = "test-ip-over:/api/over";
    const limit = 3;
    const windowMs = 60_000;

    await checkRateLimit(key, limit, windowMs);
    await checkRateLimit(key, limit, windowMs);
    await checkRateLimit(key, limit, windowMs);
    const fourth = await checkRateLimit(key, limit, windowMs);

    expect(fourth.allowed).toBe(false);
    expect(fourth.remaining).toBe(0);
  });

  it("returns correct limit and resetAt", async () => {
    const result = await checkRateLimit("test-meta:/api/meta", 10, 30_000);
    expect(result.limit).toBe(10);
    expect(result.resetAt).toBeGreaterThan(Date.now());
  });
});
