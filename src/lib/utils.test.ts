import { describe, it, expect } from "vitest";
import {
  generateTransactionCode,
  formatCredits,
  formatPrice,
  getCurrencySymbol,
} from "./utils";

describe("generateTransactionCode", () => {
  it("generates a 6-character code with allowed symbols", () => {
    const code = generateTransactionCode();
    const allowed = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
    expect(code).toMatch(allowed);
  });
});

describe("formatCredits", () => {
  it("formats numbers with locale separators", () => {
    expect(formatCredits(1000)).toMatch(/\d/);
    expect(formatCredits(0)).toBe("0");
  });
});

describe("formatPrice", () => {
  it("formats numbers as currency", () => {
    const result = formatPrice(10);
    expect(result).toContain("10");
    expect(typeof result).toBe("string");
  });
  it("formats PLN for pl locale", () => {
    const result = formatPrice(10, "pl");
    expect(result).toMatch(/\d/);
    expect(typeof result).toBe("string");
  });
});

describe("getCurrencySymbol", () => {
  it("returns USD for en", () => {
    expect(getCurrencySymbol("en")).toBe("USD");
  });
  it("returns PLN for pl", () => {
    expect(getCurrencySymbol("pl")).toBe("PLN");
  });
});
