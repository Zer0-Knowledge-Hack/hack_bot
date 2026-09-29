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
      rejectedCount: 0,
      rejections: [],
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

  it("reports rejectedCount for fields nulled by content validation, distinct from fields the model itself returned as null (RELI-001)", () => {
    // name: nulled by content validation (empty snippet). prizes: nulled by
    // content validation (snippet not verbatim). teamSize: the model
    // returned null itself — not a rejection. Expected rejectedCount: 2.
    const result = validateExtraction(
      {
        name: { value: "Meridian 2026", snippet: "", confidence: 0.9 },
        format: null,
        location: null,
        teamSize: null,
        submissionDeadline: null,
        startDate: null,
        endDate: null,
        resultsDate: null,
        prizes: { value: "prize pool", snippet: "not on the page", confidence: 0.9 },
        tracks: null,
        eligibility: null,
      },
      pageText,
    );
    expect(result.ok).toBe(true);
    expect(result.ok && result.rejectedCount).toBe(2);
    expect(result.ok && result.fields.name).toBeNull();
    expect(result.ok && result.fields.prizes).toBeNull();
    expect(result.ok && result.fields.teamSize).toBeNull();
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

  it("nulls a field whose snippet exceeds 200 characters (spec llm-extraction: Bounded Source Snippet)", () => {
    const boundaryText = "Meridian 2026 hosts teams from every continent for a full week. ".repeat(4);
    const over = boundaryText.slice(1, 202);
    const withinPage = `Prizes include the following details: ${boundaryText}`;
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
        prizes: { value: "prize pool", snippet: over, confidence: 0.9 },
        tracks: null,
        eligibility: null,
      },
      withinPage,
    );
    expect(over).toHaveLength(201);
    expect(withinPage.includes(over)).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.ok && result.fields.prizes).toBeNull();
  });

  it("keeps a field whose snippet is exactly 200 characters (spec llm-extraction: Bounded Source Snippet)", () => {
    const boundaryText = "Meridian 2026 hosts teams from every continent for a full week. ".repeat(4);
    const exact = boundaryText.slice(0, 200);
    const withinPage = `Prizes include the following details: ${boundaryText}`;
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
        prizes: { value: "prize pool", snippet: exact, confidence: 0.9 },
        tracks: null,
        eligibility: null,
      },
      withinPage,
    );
    expect(exact).toHaveLength(200);
    expect(withinPage.includes(exact)).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.ok && result.fields.prizes).toEqual({
      value: "prize pool",
      snippet: exact,
      confidence: 0.9,
    });
  });

  it("rejects a response where teamSize is a string instead of a number (RELI-001/RESI-001)", () => {
    const result = validateExtraction(
      {
        name: null,
        format: null,
        location: null,
        teamSize: { value: "4", snippet: "Team size up to 4 people", confidence: 0.8 },
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
    expect(result).toEqual({ ok: false, reason: "invalid-shape" });
  });

  it("rejects a response where name is a number instead of a string (RELI-001/RESI-001)", () => {
    const result = validateExtraction(
      {
        name: { value: 2026, snippet: "Meridian 2026", confidence: 0.9 },
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
    expect(result).toEqual({ ok: false, reason: "invalid-shape" });
  });

  it("rejects a response where a field's value is undefined (RELI-001/RESI-001)", () => {
    const result = validateExtraction(
      {
        name: { value: undefined, snippet: "Meridian 2026", confidence: 0.9 },
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
    expect(result).toEqual({ ok: false, reason: "invalid-shape" });
  });

  it("nulls a field whose snippet is empty (RISK-001: an empty snippet trivially 'matches' any page)", () => {
    const result = validateExtraction(
      {
        name: { value: "A".repeat(100_000), snippet: "", confidence: 1 },
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

  it("nulls a field whose snippet is whitespace-only (RISK-001)", () => {
    const whitespacePage = `${pageText}    `;
    const result = validateExtraction(
      {
        name: { value: "Meridian 2026", snippet: "    ", confidence: 0.9 },
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
      whitespacePage,
    );
    expect(result.ok).toBe(true);
    expect(result.ok && result.fields.name).toBeNull();
  });

  it("nulls a field whose string value exceeds the max length (RISK-001)", () => {
    const overValue = "p".repeat(501);
    const withinPage = `Prizes: ${overValue} details here.`;
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
        prizes: { value: overValue, snippet: "Prizes:", confidence: 0.9 },
        tracks: null,
        eligibility: null,
      },
      withinPage,
    );
    expect(overValue).toHaveLength(501);
    expect(result.ok).toBe(true);
    expect(result.ok && result.fields.prizes).toBeNull();
  });

  it("keeps a field whose string value is exactly at the max length (RISK-001)", () => {
    const exactValue = "p".repeat(500);
    const withinPage = `Prizes: ${exactValue} details here.`;
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
        prizes: { value: exactValue, snippet: "Prizes:", confidence: 0.9 },
        tracks: null,
        eligibility: null,
      },
      withinPage,
    );
    expect(exactValue).toHaveLength(500);
    expect(result.ok).toBe(true);
    expect(result.ok && result.fields.prizes).toEqual({
      value: exactValue,
      snippet: "Prizes:",
      confidence: 0.9,
    });
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

  describe("whitespace-insensitive verbatim check", () => {
    const NULLS = {
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
    };
    const blockPage = "Meridian 2026\n\nLocation\n\nOnline\n\n20,000 USD Prize Pool";

    function locationResult(snippet: string, page: string) {
      return validateExtraction(
        { ...NULLS, location: { value: "Online", snippet, confidence: 0.9 } },
        page,
      );
    }

    it("accepts a flattened snippet of a block-separated page", () => {
      const result = locationResult("Location Online", blockPage);
      expect(result.ok && result.rejectedCount).toBe(0);
      expect(result.ok && result.fields.location?.value).toBe("Online");
    });

    it("accepts a snippet spanning element boundaries", () => {
      const result = locationResult("Online 20,000 USD Prize Pool", blockPage);
      expect(result.ok && result.rejectedCount).toBe(0);
    });

    it("accepts NBSP and CRLF variants on either side", () => {
      const a = locationResult("Location Online now", "Location\r\n\r\nOnline now");
      expect(a.ok && a.rejectedCount).toBe(0);
      const b = locationResult("Location \tOnline\r\nnow", "Location Online now");
      expect(b.ok && b.rejectedCount).toBe(0);
    });

    it("stores the whitespace-normalized snippet", () => {
      const result = locationResult("Location\n Online", blockPage);
      expect(result.ok && result.fields.location?.snippet).toBe("Location Online");
    });

    it("still rejects a snippet that is absent from the page", () => {
      const result = locationResult("Location Mars", blockPage);
      expect(result.ok && result.rejectedCount).toBe(1);
      expect(result.ok && result.fields.location).toBeNull();
    });

    it("still rejects a snippet that differs by a real character", () => {
      const a = locationResult("Location Onlyne", "Location\n\nOnline");
      expect(a.ok && a.rejectedCount).toBe(1);
      const b = locationResult("Locat1on Online", "Location\n\nOnline");
      expect(b.ok && b.rejectedCount).toBe(1);
    });

    it("does not treat merged words as a match (whitespace is collapsed, not removed)", () => {
      const result = locationResult("LocationOnline", blockPage);
      expect(result.ok && result.rejectedCount).toBe(1);
    });

    it("still rejects an empty or whitespace-only snippet even when the page has whitespace", () => {
      const result = locationResult(" \n  ", blockPage);
      expect(result.ok && result.rejectedCount).toBe(1);
    });

    it("applies the 200-char cap to the normalized snippet", () => {
      const words = "abcdefghi ".repeat(30).trim(); // 299 chars
      const over = locationResult(words, words.split(" ").join("\n\n"));
      expect(over.ok && over.rejectedCount).toBe(1);
      const padded = `word\n\n\n\n\n${" ".repeat(300)}next`;
      const ok = locationResult(padded, "word next");
      expect(ok.ok && ok.rejectedCount).toBe(0);
    });
  });
  describe("rejection diagnostics", () => {
    const NULLS = {
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
    };

    it("reports each rejected field with its reason code", () => {
      const page = "Meridian 2026 Prizes: many";
      const result = validateExtraction(
        {
          ...NULLS,
          name: { value: "M", snippet: "", confidence: 1 },
          format: { value: "x", snippet: "y".repeat(201), confidence: 1 },
          location: { value: "x", snippet: "not on the page", confidence: 1 },
          prizes: { value: "p".repeat(501), snippet: "Prizes:", confidence: 1 },
          tracks: { value: "ok", snippet: "Meridian 2026", confidence: 1 },
        },
        page,
      );
      expect(result.ok && result.rejections).toEqual([
        { field: "name", reason: "empty-snippet" },
        { field: "format", reason: "snippet-too-long" },
        { field: "location", reason: "not-verbatim" },
        { field: "prizes", reason: "value-too-long" },
      ]);
    });

    it("reports no rejections when nothing was rejected", () => {
      const result = validateExtraction(
        { ...NULLS, name: { value: "M", snippet: "Meridian 2026", confidence: 1 } },
        "Meridian 2026",
      );
      expect(result.ok && result.rejections).toEqual([]);
    });
  });
});
