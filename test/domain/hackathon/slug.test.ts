import { describe, expect, it } from "vitest";
import { deriveBaseSlug, slugForAttempt } from "../../../src/domain/hackathon/slug";

describe("deriveBaseSlug", () => {
  it("stores the first analysis under the base slug (spec: First analysis gets the base slug)", () => {
    expect(deriveBaseSlug("Meridian")).toBe("meridian");
  });

  it("lowercases, strips diacritics via NFKD, and replaces non [a-z0-9-] runs with a hyphen", () => {
    expect(deriveBaseSlug("Café Hackathón 2026!")).toBe("cafe-hackathon-2026");
  });

  it("falls back to the host when no name is available", () => {
    expect(deriveBaseSlug("example.com")).toBe("example-com");
  });

  it("caps the slug at 40 characters and trims a trailing hyphen at the cut", () => {
    const longName = "a".repeat(45);
    const result = deriveBaseSlug(longName);
    expect(result.length).toBeLessThanOrEqual(40);
    expect(result.endsWith("-")).toBe(false);
  });

  it("collapses repeated separators and trims leading/trailing hyphens", () => {
    expect(deriveBaseSlug("  --Multi   Space--  ")).toBe("multi-space");
  });
});

describe("slugForAttempt", () => {
  it("returns the base slug unchanged on the first attempt", () => {
    expect(slugForAttempt("meridian", 1, "abc123")).toBe("meridian");
  });

  it("appends a numeric suffix on a collision (spec: Collision appends a numeric suffix)", () => {
    expect(slugForAttempt("meridian", 2, "abc123")).toBe("meridian-2");
  });

  it("keeps numeric suffixes through attempt 99", () => {
    expect(slugForAttempt("meridian", 99, "abc123")).toBe("meridian-99");
  });

  it("falls back to a random hex suffix past attempt 99", () => {
    expect(slugForAttempt("meridian", 100, "abc123")).toBe("meridian-abc123");
  });
});
