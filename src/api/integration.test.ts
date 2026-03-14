/**
 * API Integration Tests
 *
 * Runs against a live Next.js + Go backend when API_TEST_BASE_URL is set.
 * Skip with: npm test -- --run (excluded by default via test.exclude)
 * Or run explicitly: npm test -- --run src/api/integration.test.ts
 *
 * To run against local dev server:
 *   API_TEST_BASE_URL=http://localhost:3000 npm test -- --run src/api/integration.test.ts
 */

import { describe, it, expect, beforeAll } from "vitest";

const BASE = process.env.API_TEST_BASE_URL || "http://localhost:3000";

const shouldRunIntegration = !!process.env.API_TEST_BASE_URL;

describe.skipIf(!shouldRunIntegration)("API Integration Tests", () => {
  beforeAll(() => {
    if (!shouldRunIntegration) {
      console.log("Skipping: Set API_TEST_BASE_URL to run integration tests");
    }
  });

  describe("Public Endpoints (no auth)", () => {
    it("GET /api/models returns 200 and models array", async () => {
      const res = await fetch(`${BASE}/api/models?limit=5`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as { models?: unknown[]; nextCursor?: string | null };
      expect(Array.isArray(data.models)).toBe(true);
    });

    it("GET /api/models response matches contract (models + nextCursor)", async () => {
      const res = await fetch(`${BASE}/api/models?limit=2`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as { models?: { id?: number; folderName?: string }[]; nextCursor?: string | null };
      expect(data).toHaveProperty("models");
      expect(data).toHaveProperty("nextCursor");
      if (data.models && data.models.length > 0) {
        expect(data.models[0]).toHaveProperty("folderName");
      }
    });

    it("GET /api/models includes rate limit headers", async () => {
      const res = await fetch(`${BASE}/api/models?limit=1`);
      expect(res.headers.get("X-RateLimit-Limit")).toBeTruthy();
      expect(res.headers.get("X-RateLimit-Remaining")).toBeTruthy();
    });

    it("GET /api/settings/public returns 200", async () => {
      const res = await fetch(`${BASE}/api/settings/public`);
      expect([200, 404]).toContain(res.status);
    });
  });

  describe("Auth Endpoints", () => {
    it("POST /api/auth/login with invalid creds returns 401 or 400", async () => {
      const res = await fetch(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "nonexistent@test.com", password: "wrong" }),
      });
      expect([400, 401]).toContain(res.status);
    });

    it("POST /api/auth/register without Turnstile returns 400 or 422", async () => {
      const res = await fetch(`${BASE}/api/auth/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: BASE,
        },
        body: JSON.stringify({
          email: "bot_test@example.com",
          username: "bottest",
          password: "ValidPass123!",
        }),
      });
      expect([400, 422]).toContain(res.status);
    });
  });

  describe("Protected Endpoints (require auth)", () => {
    it("GET /api/auth/me without cookie returns 401", async () => {
      const res = await fetch(`${BASE}/api/auth/me`);
      expect(res.status).toBe(401);
    });

    it("GET /api/user/balance without cookie returns 401", async () => {
      const res = await fetch(`${BASE}/api/user/balance`);
      expect(res.status).toBe(401);
    });
  });

  describe("CSRF Protection", () => {
    it("POST to /api/user/profile with evil Origin returns 403", async () => {
      const res = await fetch(`${BASE}/api/user/profile`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://evil.com",
        },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(403);
    });
  });

  describe("Rate Limiting", () => {
    it("excessive requests to same path eventually return 429", async () => {
      const path = `${BASE}/api/models?limit=1`;
      let lastStatus = 0;
      for (let i = 0; i < 130; i++) {
        const res = await fetch(path);
        lastStatus = res.status;
        if (res.status === 429) break;
      }
      expect(lastStatus).toBe(429);
    }, 60_000);
  });

  describe("Performance (SLA)", () => {
    it("GET /api/models responds within 2000ms (relaxed for CI)", async () => {
      const start = performance.now();
      const res = await fetch(`${BASE}/api/models?limit=5`);
      const elapsed = performance.now() - start;
      expect(res.status).toBe(200);
      expect(elapsed).toBeLessThan(2000);
    });
  });
});
