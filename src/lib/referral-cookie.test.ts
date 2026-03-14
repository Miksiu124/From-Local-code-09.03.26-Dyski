import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setRefCookie, getRefCookie } from "./referral-cookie";

describe("referral-cookie", () => {
  const originalDocument = global.document;

  beforeEach(() => {
    Object.defineProperty(global, "document", {
      value: {
        cookie: "",
      },
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(global, "document", {
      value: originalDocument,
      writable: true,
    });
  });

  it("setRefCookie stores value", () => {
    setRefCookie("ABC123");
    expect(document.cookie).toContain("ref_code=");
    expect(document.cookie).toContain("ABC123");
  });

  it("setRefCookie trims and uppercases", () => {
    setRefCookie("  xyz  ");
    expect(document.cookie).toContain("XYZ");
  });

  it("setRefCookie ignores empty", () => {
    const before = document.cookie;
    setRefCookie("");
    setRefCookie("   ");
    expect(document.cookie).toBe(before);
  });

  it("getRefCookie returns stored value", () => {
    document.cookie = "ref_code=ABC123; path=/";
    expect(getRefCookie()).toBe("ABC123");
  });

  it("getRefCookie returns empty when not set", () => {
    document.cookie = "";
    expect(getRefCookie()).toBe("");
  });
});
