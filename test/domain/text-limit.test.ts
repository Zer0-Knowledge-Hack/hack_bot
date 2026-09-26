import { describe, expect, it } from "vitest";
import { joinLinesWithinLimit } from "../../src/domain/text-limit";

describe("joinLinesWithinLimit", () => {
  it("joins all lines when the total is within the limit (spec: Listing within the limit)", () => {
    const lines = ["one", "two", "three"];
    expect(joinLinesWithinLimit(lines, 4096)).toBe("one\ntwo\nthree");
  });

  it("returns a fixed message when there are no lines", () => {
    expect(joinLinesWithinLimit([], 4096, "Nothing yet.")).toBe("Nothing yet.");
  });

  it("truncates and appends an '...and N more' note when over the limit (spec: Listing exceeds the limit)", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line-${i}`.repeat(20));
    const result = joinLinesWithinLimit(lines, 200);
    expect(result.length).toBeLessThanOrEqual(200);
    expect(result).toMatch(/\.\.\.and \d+ more$/);
  });

  it("never exceeds the limit even in the pathological case where no line fits", () => {
    const lines = ["x".repeat(500)];
    const result = joinLinesWithinLimit(lines, 50);
    expect(result.length).toBeLessThanOrEqual(50);
  });
});
