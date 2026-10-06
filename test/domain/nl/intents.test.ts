import { describe, expect, it } from "vitest";
import { parseIntentResult, NL_CONFIDENCE_FLOOR } from "../../../src/domain/nl/intents";

describe("parseIntentResult", () => {
  it("accepts a valid intent above the confidence floor", () => {
    expect(
      parseIntentResult({
        intent: "list_hackathons",
        confidence: NL_CONFIDENCE_FLOOR,
        slots: { slug: "meridian" },
      }),
    ).toEqual({
      intent: "list_hackathons",
      confidence: NL_CONFIDENCE_FLOOR,
      slots: { slug: "meridian" },
    });
  });

  it("maps unknown intent ids and low confidence to unknown", () => {
    expect(parseIntentResult({ intent: "nope", confidence: 0.99, slots: {} })).toMatchObject({
      intent: "unknown",
    });
    expect(parseIntentResult({ intent: "help", confidence: 0.54, slots: {} })).toMatchObject({
      intent: "unknown",
    });
  });

  it("returns null for non-object shapes", () => {
    expect(parseIntentResult(null)).toBeNull();
    expect(parseIntentResult("help")).toBeNull();
    expect(parseIntentResult([])).toBeNull();
  });
});
