import { describe, expect, it } from "vitest";
import { timingSafeCompare } from "../../../src/adapters/crypto/timing-safe-compare";

// READ-001 correction: this is the constant-time comparison previously
// duplicated in src/index.ts's isValidSecret and
// src/adapters/github/signature.ts's verifyGithubSignature — extracted here
// so both call one implementation. Length is checked before
// crypto.subtle.timingSafeEqual (which requires equal-length inputs), same
// as the two call sites it replaces.

describe("timingSafeCompare", () => {
  it("returns true for two strings with identical bytes", () => {
    expect(timingSafeCompare("webhook-secret-value", "webhook-secret-value")).toBe(true);
  });

  it("returns false for two same-length strings with different bytes", () => {
    expect(timingSafeCompare("webhook-secret-value", "webhook-secret-diff!")).toBe(false);
  });

  it("returns false when the provided string is shorter than expected (length-checked before compare)", () => {
    expect(timingSafeCompare("short", "webhook-secret-value")).toBe(false);
  });

  it("returns false when the provided string is longer than expected", () => {
    expect(timingSafeCompare("webhook-secret-value-and-then-some", "webhook-secret-value")).toBe(
      false,
    );
  });

  it("returns false for an empty provided value against a non-empty expected value", () => {
    expect(timingSafeCompare("", "webhook-secret-value")).toBe(false);
  });
});
