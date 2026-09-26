import { describe, expect, it } from "vitest";
import { validateExtraction } from "../../../src/domain/hackathon/extraction";

const pageText = "Meridian 2026 starts on 2026-03-01. Team size up to 4 people.";

describe("validateExtraction", () => {
  it("accepts a well-formed response matching the fixed schema (spec llm-extraction: Well-formed response passes validation)", () => {
    const result = validateExtraction(
      {
        name: { value: "Meridian 2026", snippet: "Meridian 2026", confidence: 0.9 },
        format: null,
        location: null,
        teamSize: {
          value: 4,
          snippet: "Team size up to 4 people",
          confidence: 0.8,
        },
        submissionDeadline: null,
        startDate: { value: "2026-03-01", snippet: "starts on 2026-03-01", confidence: 0.7 },
        endDate: null,
        resultsDate: null,
        prizes: null,
        tracks: null,
        eligibility: null,
      },
      pageText,
    );
    expect(result).toEqual({
      ok: true,
      fields: {
        name: { value: "Meridian 2026", snippet: "Meridian 2026", confidence: 0.9 },
        format: null,
        location: null,
        teamSize: { value: 4, snippet: "Team size up to 4 people", confidence: 0.8 },
        submissionDeadline: null,
        startDate: { value: "2026-03-01", snippet: "starts on 2026-03-01", confidence: 0.7 },
        endDate: null,
        resultsDate: null,
        prizes: null,
        tracks: null,
        eligibility: null,
      },
    });
  });

  it("rejects a response missing required shape (spec llm-extraction: Malformed response is rejected)", () => {
    const result = validateExtraction({ name: { value: "Meridian" } }, pageText);
    expect(result).toEqual({ ok: false, reason: "invalid-shape" });
  });

  it("rejects unparseable input", () => {
    const result = validateExtraction("not json at all", pageText);
    expect(result).toEqual({ ok: false, reason: "invalid-shape" });
  });

  it("treats a missing field as null rather than guessing (spec llm-extraction: Missing field is null, not guessed)", () => {
    const result = validateExtraction(
      {
        name: null,
        format: null,
        location: null,
        teamSize: null,
        submissionDeadline: null,
        startDate: null,
        endDate: null,
        resultsDate: null,
        prizes: null,
        tracks: null,
        eligibility: null,
      },
      pageText,
    );
    expect(result.ok).toBe(true);
    expect(result.ok && result.fields.teamSize).toBeNull();
  });

  it("nulls a field whose snippet exceeds 160 characters (spec llm-extraction: Bounded Source Snippet)", () => {
    const longSnippet = "Meridian 2026 starts on 2026-03-01. " + "x".repeat(160);
    const result = validateExtraction(
      {
        name: { value: "Meridian 2026", snippet: longSnippet, confidence: 0.9 },
        format: null,
        location: null,
        teamSize: null,
        submissionDeadline: null,
        startDate: null,
        endDate: null,
        resultsDate: null,
        prizes: null,
        tracks: null,
        eligibility: null,
      },
      pageText,
    );
    expect(result.ok).toBe(true);
    expect(result.ok && result.fields.name).toBeNull();
  });

  it("nulls a field whose snippet is not found verbatim in the page text", () => {
    const result = validateExtraction(
      {
        name: { value: "Meridian 2026", snippet: "this text is not on the page", confidence: 0.9 },
        format: null,
        location: null,
        teamSize: null,
        submissionDeadline: null,
        startDate: null,
        endDate: null,
        resultsDate: null,
        prizes: null,
        tracks: null,
        eligibility: null,
      },
      pageText,
    );
    expect(result.ok).toBe(true);
    expect(result.ok && result.fields.name).toBeNull();
  });
});
