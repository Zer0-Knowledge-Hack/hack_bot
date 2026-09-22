import { describe, expect, it } from "vitest";

describe("crypto.subtle.timingSafeEqual availability", () => {
  it("is exposed as a function on the Workers WebCrypto implementation", () => {
    expect(typeof crypto.subtle.timingSafeEqual).toBe("function");
  });

  it("returns true for two buffers with identical bytes", () => {
    const a = new TextEncoder().encode("webhook-secret-value");
    const b = new TextEncoder().encode("webhook-secret-value");

    expect(crypto.subtle.timingSafeEqual(a, b)).toBe(true);
  });

  it("returns false for two same-length buffers with different bytes", () => {
    const a = new TextEncoder().encode("webhook-secret-value");
    const b = new TextEncoder().encode("webhook-secret-diff!");

    expect(crypto.subtle.timingSafeEqual(a, b)).toBe(false);
  });
});
