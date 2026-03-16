import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

describe("API Middleware Security", () => {
  const baseUrl = "http://localhost:3000";

  beforeEach(() => {
    vi.resetModules();
  });

  describe("CSRF Protection", () => {
    it("blocks POST without Origin/Referer from different origin", async () => {
      const req = new NextRequest(`${baseUrl}/api/user/profile`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://evil.com",
        },
      });

      const res = await middleware(req);
      expect(res.status).toBe(403);
      expect(await res.text()).toContain("Invalid origin");
    });

    it("allows POST with matching Origin", async () => {
      const req = new NextRequest(`${baseUrl}/api/user/profile`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: baseUrl,
        },
      });

      const res = await middleware(req);
      expect(res.status).toBe(200);
    });

    it("allows auth routes without strict origin check (login/register)", async () => {
      const req = new NextRequest(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://evil.com",
        },
      });

      const res = await middleware(req);
      // Auth routes are exempt from CSRF - request passes middleware
      expect(res.status).toBe(200);
    });

    it("allows GET requests without Origin", async () => {
      const req = new NextRequest(`${baseUrl}/api/models`, {
        method: "GET",
      });

      const res = await middleware(req);
      expect(res.status).toBe(200);
    });
  });

  describe("Rate Limit Headers", () => {
    it("includes X-RateLimit headers on response", async () => {
      const req = new NextRequest(`${baseUrl}/api/models`, {
        method: "GET",
        headers: { "x-forwarded-for": "1.2.3.4" },
      });

      const res = await middleware(req);
      expect(res.headers.get("X-RateLimit-Limit")).toBe("400");
      expect(res.headers.get("X-RateLimit-Remaining")).toBeDefined();
      expect(res.headers.get("X-RateLimit-Reset")).toBeDefined();
    });
  });
});
