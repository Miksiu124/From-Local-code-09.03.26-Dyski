import { describe, it, expect } from "vitest";
import { classifySignupFailureReason } from "@/lib/growth-analytics";

describe("classifySignupFailureReason", () => {
  it("turnstile expired copy from backend", () => {
    expect(
      classifySignupFailureReason(
        400,
        "Verification expired. Please complete the challenge again and submit.",
      ),
    ).toBe("turnstile_expired");
  });

  it("turnstile misconfigured (secret)", () => {
    expect(
      classifySignupFailureReason(400, "Verification failed. Please try again or contact support."),
    ).toBe("turnstile_misconfigured");
  });

  it("turnstile verify failed (upstream/decode)", () => {
    expect(
      classifySignupFailureReason(400, "Verification failed. Please complete the challenge again and submit."),
    ).toBe("turnstile_verify_failed");
  });

  it("email taken", () => {
    expect(
      classifySignupFailureReason(400, "Unable to create account. Please try a different email or log in."),
    ).toBe("email_taken");
  });

  it("network", () => {
    expect(classifySignupFailureReason(0, "fetch failed")).toBe("network");
  });
});
