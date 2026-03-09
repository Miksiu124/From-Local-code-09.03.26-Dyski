import { describe, it, expect } from "vitest";
import {
  generateTransactionCode,
  formatCredits,
  formatPrice,
  getCurrencySymbol,
  convertPlnToUsd,
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

describe("convertPlnToUsd", () => {
  it("converts PLN to USD with ceil (4 PLN = 1 USD)", () => {
    expect(convertPlnToUsd(40)).toBe(10);
    expect(convertPlnToUsd(50)).toBe(13);
    expect(convertPlnToUsd(41)).toBe(11);
  });
});

describe("formatPrice", () => {
  it("formats USD for en locale (PLN to USD, ceil)", () => {
    const result = formatPrice(40, "en");
    expect(result).toContain("10");
    expect(result).toMatch(/\$|USD/);
    expect(typeof result).toBe("string");
  });
  it("formats PLN for pl locale (price is PLN)", () => {
    const result = formatPrice(40, "pl");
    expect(result).toContain("40");
    expect(result).toMatch(/zł|PLN/);
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
