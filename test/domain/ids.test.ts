import { describe, expect, it } from "vitest";
import { parseTeamId } from "../../src/domain/ids";

describe("parseTeamId (validated TeamId construction for untrusted input)", () => {
  it("accepts a UUID-shaped team id", () => {
    expect(parseTeamId("00000000-0000-4000-8000-000000000001")).toBe(
      "00000000-0000-4000-8000-000000000001",
    );
  });

  it.each([
    ["1 char (lower bound)", "a"],
    ["64 chars (upper bound)", "a".repeat(64)],
  ])("accepts a boundary-length id (%s)", (_label, raw) => {
    expect(parseTeamId(raw)).toBe(raw);
  });

  it.each([
    ["empty", ""],
    ["whitespace", "   "],
    ["path traversal", "../team"],
    ["SQL-ish", "1' OR '1'='1"],
    ["too long (65 chars)", "a".repeat(65)],
    ["unicode", "tëam"],
    ["embedded newline", "team\n1"],
  ])("rejects a malformed id (%s)", (_label, raw) => {
    expect(parseTeamId(raw)).toBeNull();
  });
});
