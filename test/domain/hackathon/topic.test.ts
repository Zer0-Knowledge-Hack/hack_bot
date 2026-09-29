import { describe, expect, it } from "vitest";
import { topicLink, topicNameFor } from "../../../src/domain/hackathon/topic";

describe("topicNameFor with the icon applied", () => {
  it("is the plain sanitized name, whitespace collapsed, no emoji", () => {
    expect(topicNameFor("Meridian  Hack\n2026", "meridian", true)).toBe("Meridian Hack 2026");
  });

  it("strips control and bidi format characters", () => {
    expect(topicNameFor("Mer\u0000id\u202Eian\u200B", "meridian", true)).toBe("Meridian");
  });

  it("falls back to the slug when the name is missing or empty after sanitizing", () => {
    expect(topicNameFor(undefined, "meridian", true)).toBe("meridian");
    expect(topicNameFor(null, "meridian", true)).toBe("meridian");
    expect(topicNameFor(" ​\n ", "meridian-2", true)).toBe("meridian-2");
  });

  it("keeps a name of exactly 128 UTF-16 units untouched", () => {
    const name = "a".repeat(128);
    expect(topicNameFor(name, "s", true)).toBe(name);
  });

  it("cuts an overlong name to at most 128 units and ends with an ellipsis", () => {
    const out = topicNameFor("b".repeat(300), "s", true);
    expect(out.length).toBeLessThanOrEqual(128);
    expect(out.startsWith("bbb")).toBe(true);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("topicNameFor without an icon (fallback)", () => {
  it("prefixes the name with the trophy", () => {
    expect(topicNameFor("Meridian  Hack\n2026", "meridian", false)).toBe("🏆 Meridian Hack 2026");
    expect(topicNameFor(null, "meridian", false)).toBe("🏆 meridian");
  });

  it("keeps a name that fits within 128 UTF-16 units untouched", () => {
    const name = "a".repeat(128 - "🏆 ".length);
    const out = topicNameFor(name, "s", false);
    expect(out).toBe(`🏆 ${name}`);
    expect(out.length).toBe(128);
  });

  it("cuts an overlong name to at most 128 units and ends with an ellipsis", () => {
    const out = topicNameFor("b".repeat(300), "s", false);
    expect(out.length).toBeLessThanOrEqual(128);
    expect(out.startsWith("🏆 bbb")).toBe(true);
    expect(out.endsWith("…")).toBe(true);
  });

  it("never splits a surrogate pair when cutting", () => {
    // "🏆 " is 3 units; each 😀 is 2 units, so the cut lands mid-pair.
    const out = topicNameFor("😀".repeat(100), "s", false);
    expect(out.length).toBeLessThanOrEqual(128);
    expect(out.endsWith("…")).toBe(true);
    expect(/[�-�](?![�-�])|(?<![�-�])[�-�]/.test(out)).toBe(false);
  });
});

describe("sanitizeTopicName reuse for the confirmation text", () => {
  it("is exported and returns the sanitized name without the emoji", async () => {
    const { sanitizeTopicName } = await import("../../../src/domain/hackathon/topic");
    expect(sanitizeTopicName("Meridian  Hack\n2026", "meridian")).toBe("Meridian Hack 2026");
    expect(sanitizeTopicName("", "meridian")).toBe("meridian");
  });
});

describe("topicLink", () => {
  it("strips the -100 prefix from a supergroup chat id", () => {
    expect(topicLink(-1001234567890, 42)).toBe("https://t.me/c/1234567890/42");
  });

  it("returns null when the chat id is not a -100 supergroup id", () => {
    expect(topicLink(-555, 42)).toBeNull();
    expect(topicLink(123, 42)).toBeNull();
  });
});
