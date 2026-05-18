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

    it("blocks cross-site POST on auth routes (same CSRF rules as other APIs)", async () => {
      const req = new NextRequest(`${baseUrl}/api/auth/login`, {
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

    it("allows GET requests without Origin", async () => {
      const req = new NextRequest(`${baseUrl}/api/models`, {
        method: "GET",
      });

      const res = await middleware(req);
      expect(res.status).toBe(200);
    });
  });

  describe("WWW redirect", () => {
    it("301 redirects www host to apex", async () => {
      const req = new NextRequest("https://www.dyskiof.net/models/foo", {
        headers: { host: "www.dyskiof.net" },
      });

      const res = await middleware(req);
      expect(res.status).toBe(301);
      expect(res.headers.get("location")).toBe("https://dyskiof.net/models/foo");
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
