import { describe, it, expect } from "vitest";
import { generateTransactionCode } from "./utils";

describe("generateTransactionCode", () => {
  it("generates a 12-character code with allowed symbols", () => {
    const code = generateTransactionCode();
    const allowed = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{12}$/;
    expect(code).toMatch(allowed);
  });
});
