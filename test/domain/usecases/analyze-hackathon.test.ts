import { describe, expect, it } from "vitest";
import { analyzeHackathon } from "../../../src/domain/usecases/analyze-hackathon";
import {
  BrowserQuotaExceededError,
  ExtractionFailedError,
  PageFetchFailedError,
  PageTooThinError,
  UnsafeUrlError,
} from "../../../src/domain/errors";
import { asTeamId } from "../../../src/domain/ids";
import {
  fakeClock,
  fakeHackathonAnalysisRepo,
  fakeIdGen,
  fakeLlmExtractor,
  fakePageFetcher,
  fakeRepoTopicLinkRepo,
} from "../../fakes";

const TEAM_ID = asTeamId("team-1");
const SOURCE_URL = "https://example.com/event";
const NORMALIZED_URL = "https://example.com/event";

// RISK-001: `sanitizeField` now nulls a field whose snippet is empty or
// not verbatim in the page text, so every fixture below must carry a
// snippet that actually occurs in whichever page text the LLM will see.
function validRaw(snippet: string) {
  return {
    name: { value: "Meridian", snippet, confidence: 0.9 },
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
}

function makeDeps(overrides: {
  staticText?: string;
  renderedText?: string;
  renderedThrows?: unknown;
} = {}) {
  const staticText = overrides.staticText ?? "x".repeat(900);
  const staticFetcher = fakePageFetcher([{ text: staticText }]);
  const renderedFetcher = overrides.renderedThrows
    ? fakePageFetcher([{ throws: overrides.renderedThrows }])
    : fakePageFetcher([{ text: overrides.renderedText ?? "y".repeat(900) }]);
  // The page text the LLM actually receives is the rendered text when one
  // is supplied (the browser-fallback path), otherwise the static text —
  // mirrors resolvePageText's own selection.
  const llmSourceText = overrides.renderedText ?? staticText;
  const llmExtractor = fakeLlmExtractor([
    { raw: validRaw(llmSourceText.slice(0, 5)) },
  ]);
  return {
    staticFetcher,
    renderedFetcher,
    llmExtractor,
    hackathonAnalysisRepo: fakeHackathonAnalysisRepo(),
    repoTopicLinkRepo: fakeRepoTopicLinkRepo(),
    clock: fakeClock(),
    idGen: fakeIdGen(),
  };
}

// fakeClock() starts here; a 180 s attempt budget is the design default.
const CLOCK_START = 1_700_000_000_000;

function makeInput(deadlineAt = CLOCK_START + 180_000) {
  return {
    teamId: TEAM_ID,
    sourceUrl: SOURCE_URL,
    normalizedUrl: NORMALIZED_URL,
    primaryModel: "@cf/primary",
    fallbackModel: "@cf/fallback",
    deadlineAt,
  };
}

describe("analyzeHackathon: static-then-browser fallback on thin static text", () => {
  it("invokes the rendered fetcher and uses its text when static text is below 800 chars", async () => {
    const deps = makeDeps({ staticText: "short", renderedText: "z".repeat(900) });

    const result = await analyzeHackathon(makeInput(), deps);

    expect(deps.renderedFetcher.calls).toEqual([SOURCE_URL]);
    expect(deps.llmExtractor.calls[0]?.pageText).toBe("z".repeat(900));
    expect(result.fields.name?.value).toBe("Meridian");
  });

  it("does not invoke the rendered fetcher when static text meets the length heuristic", async () => {
    const deps = makeDeps({ staticText: "x".repeat(900) });

    await analyzeHackathon(makeInput(), deps);

    expect(deps.renderedFetcher.calls).toEqual([]);
  });
});

describe("analyzeHackathon: browser fallback when the static fetch is bot-walled", () => {
  function botWallDeps(staticError: unknown, rendered: Parameters<typeof fakePageFetcher>[0]) {
    const deps = makeDeps({ renderedText: "z".repeat(900) });
    deps.staticFetcher = fakePageFetcher([{ throws: staticError }]);
    deps.renderedFetcher = fakePageFetcher(rendered);
    return deps;
  }

  it.each([401, 403, 429, 503])(
    "falls back to the rendered fetcher on a static http-status %i",
    async (status) => {
      const deps = botWallDeps(
        new PageFetchFailedError(`unexpected HTTP status ${status}`, "http-status", status),
        [{ text: "z".repeat(900) }],
      );

      const result = await analyzeHackathon(makeInput(), deps);

      expect(deps.renderedFetcher.calls).toEqual([SOURCE_URL]);
      expect(deps.llmExtractor.calls[0]?.pageText).toBe("z".repeat(900));
      expect(result.fields.name?.value).toBe("Meridian");
    },
  );

  it.each([404, 410, 500])(
    "propagates a static http-status %i without calling the rendered fetcher",
    async (status) => {
      const err = new PageFetchFailedError(`unexpected HTTP status ${status}`, "http-status", status);
      const deps = botWallDeps(err, [{ text: "z".repeat(900) }]);

      const thrown: unknown = await analyzeHackathon(makeInput(), deps).catch((e: unknown) => e);

      expect(thrown).toBe(err);
      expect(deps.renderedFetcher.calls).toEqual([]);
    },
  );

  it.each(["timeout", "network", "content-type", "redirects", "too-large"] as const)(
    "propagates a static %s failure without calling the rendered fetcher",
    async (kind) => {
      const err = new PageFetchFailedError("static failed", kind);
      const deps = botWallDeps(err, [{ text: "z".repeat(900) }]);

      const thrown: unknown = await analyzeHackathon(makeInput(), deps).catch((e: unknown) => e);

      expect(thrown).toBe(err);
      expect(deps.renderedFetcher.calls).toEqual([]);
    },
  );

  it("propagates an UnsafeUrlError without calling the rendered fetcher", async () => {
    const err = new UnsafeUrlError("blocked", "private-ip");
    const deps = botWallDeps(err, [{ text: "z".repeat(900) }]);

    const thrown: unknown = await analyzeHackathon(makeInput(), deps).catch((e: unknown) => e);

    expect(thrown).toBe(err);
    expect(deps.renderedFetcher.calls).toEqual([]);
  });

  it("surfaces the rendered error when the rendered fetch fails after a bot-wall", async () => {
    const renderedErr = new PageFetchFailedError("rendered fetch timed out", "timeout");
    const deps = botWallDeps(
      new PageFetchFailedError("unexpected HTTP status 403", "http-status", 403),
      [{ throws: renderedErr }],
    );

    const thrown: unknown = await analyzeHackathon(makeInput(), deps).catch((e: unknown) => e);

    expect(thrown).toBe(renderedErr);
    expect(deps.renderedFetcher.calls).toEqual([SOURCE_URL]);
  });

  it("reports PageTooThinError (browser quota) when the browser quota is exhausted after a bot-wall", async () => {
    const deps = botWallDeps(
      new PageFetchFailedError("unexpected HTTP status 429", "http-status", 429),
      [{ throws: new BrowserQuotaExceededError("429") }],
    );

    const thrown: unknown = await analyzeHackathon(makeInput(), deps).catch((e: unknown) => e);

    expect(thrown).toBeInstanceOf(PageTooThinError);
    expect((thrown as PageTooThinError).browserQuotaDegraded).toBe(true);
  });
});

describe("analyzeHackathon: browser rendering quota exhaustion (429) degrade path", () => {
  it("uses the static text when it has at least 200 characters", async () => {
    const staticText = "s".repeat(200);
    const deps = makeDeps({
      staticText,
      renderedThrows: new BrowserQuotaExceededError("429"),
    });

    const result = await analyzeHackathon(makeInput(), deps);

    expect(deps.llmExtractor.calls[0]?.pageText).toBe(staticText);
    expect(result.fields.name?.value).toBe("Meridian");
  });

  it("reports PageTooThinError when the static text has fewer than 200 characters", async () => {
    const deps = makeDeps({
      staticText: "s".repeat(199),
      renderedThrows: new BrowserQuotaExceededError("429"),
    });

    const thrown: unknown = await analyzeHackathon(makeInput(), deps).catch(
      (e: unknown) => e,
    );
    expect(thrown).toBeInstanceOf(PageTooThinError);
    expect((thrown as PageTooThinError).browserQuotaDegraded).toBe(true);
  });
});

describe("analyzeHackathon: primary-then-fallback LLM call", () => {
  it("calls only the primary model when its output validates", async () => {
    const deps = makeDeps();
    const tracked = fakeLlmExtractor([{ raw: validRaw("xxxxx") }]);
    deps.llmExtractor = tracked;

    await analyzeHackathon(makeInput(), deps);

    expect(tracked.calls).toHaveLength(1);
    expect(tracked.calls[0]?.modelId).toBe("@cf/primary");
  });

  it("falls back to the fallback model when the primary output fails validation", async () => {
    const deps = makeDeps();
    const tracked = fakeLlmExtractor([
      { raw: { not: "valid" } },
      { raw: validRaw("xxxxx") },
    ]);
    deps.llmExtractor = tracked;

    const result = await analyzeHackathon(makeInput(), deps);

    expect(tracked.calls).toHaveLength(2);
    expect(tracked.calls[1]?.modelId).toBe("@cf/fallback");
    expect(result.fields.name?.value).toBe("Meridian");
  });

  const FIELD_ORDER = [
    "name",
    "format",
    "location",
    "teamSize",
    "submissionDeadline",
    "startDate",
    "endDate",
    "resultsDate",
    "prizes",
    "tracks",
    "eligibility",
  ] as const;

  // Builds a raw response where the first `n` fields are syntactically
  // valid but content-invalid (empty snippet -> nulled by sanitizeField,
  // RELI-001's "rejectedCount"), and the rest are fields the model itself
  // returned as null (not a rejection).
  function rawWithRejectedCount(n: number) {
    const raw: Record<string, unknown> = {};
    for (const [i, field] of FIELD_ORDER.entries()) {
      raw[field] =
        i < n
          ? { value: field === "teamSize" ? 1 : "x", snippet: "", confidence: 0.5 }
          : null;
    }
    return raw;
  }

  it("majority rejected (>half of 11 fields nulled by content validation) triggers the fallback (RELI-001)", async () => {
    const deps = makeDeps();
    const tracked = fakeLlmExtractor([
      { raw: rawWithRejectedCount(6) },
      { raw: validRaw("xxxxx") },
    ]);
    deps.llmExtractor = tracked;

    const result = await analyzeHackathon(makeInput(), deps);

    expect(tracked.calls).toHaveLength(2);
    expect(tracked.calls[1]?.modelId).toBe("@cf/fallback");
    expect(result.fields.name?.value).toBe("Meridian");
  });

  it("raises ExtractionFailedError(invalid-output) when both primary and fallback are majority-rejected, with exactly 2 calls (RELI-001)", async () => {
    const deps = makeDeps();
    const tracked = fakeLlmExtractor([
      { raw: rawWithRejectedCount(6) },
      { raw: rawWithRejectedCount(7) },
    ]);
    deps.llmExtractor = tracked;

    const thrown: unknown = await analyzeHackathon(makeInput(), deps).catch(
      (e: unknown) => e,
    );

    expect(tracked.calls).toHaveLength(2);
    expect(thrown).toBeInstanceOf(ExtractionFailedError);
    expect((thrown as ExtractionFailedError).kind).toBe("invalid-output");
  });

  it("attaches per-attempt diagnostics (model, parsed, rejectedCount, field+reason) to the invalid-output error", async () => {
    const deps = makeDeps();
    const primary = rawWithRejectedCount(6);
    // Fallback returns a shape-invalid response (unparseable for our schema).
    deps.llmExtractor = fakeLlmExtractor([{ raw: primary }, { raw: "not an object" }]);

    const thrown = (await analyzeHackathon(makeInput(), deps).catch(
      (e: unknown) => e,
    )) as ExtractionFailedError;

    expect(thrown).toBeInstanceOf(ExtractionFailedError);
    expect(thrown.attempts).toEqual([
      {
        model: "@cf/primary",
        parsed: true,
        rejectedCount: 6,
        rejected: FIELD_ORDER.slice(0, 6).map((field) => ({ field, reason: "empty-snippet" })),
      },
      // Parsing succeeded (a JSON value arrived) but the top level is not an
      // object: parsed stays true and shape reports the validation failure.
      { model: "@cf/fallback", parsed: true, shape: "invalid", rejectedCount: 0, rejected: [] },
    ]);
  });

  it("parsed means only that JSON parsing succeeded: a parsed non-object reports shape invalid, an unparseable text does not", async () => {
    const deps = makeDeps();
    deps.llmExtractor = fakeLlmExtractor([
      { raw: [1, 2], meta: { finishReason: "stop", contentLength: 5, parseFailure: "non-object" } },
      { raw: null, meta: { finishReason: "stop", contentLength: 9, parseFailure: "not-json" } },
    ]);

    const thrown = (await analyzeHackathon(makeInput(), deps).catch(
      (e: unknown) => e,
    )) as ExtractionFailedError;

    expect(thrown.attempts?.[0]).toMatchObject({ parsed: true, shape: "invalid", parseFailure: "non-object" });
    expect(thrown.attempts?.[1]).toMatchObject({ parsed: false, parseFailure: "not-json" });
    expect(thrown.attempts?.[1]).not.toHaveProperty("shape");
  });

  it("a majority of wrong-shape fields falls back and is reported as wrong-shape rejections, not as parsed:false", async () => {
    const deps = makeDeps();
    const wrongShape: Record<string, unknown> = {};
    for (const field of FIELD_ORDER) wrongShape[field] = { value: ["x"], snippet: "Meridian", confidence: 1 };
    deps.llmExtractor = fakeLlmExtractor([{ raw: wrongShape }, { raw: wrongShape }]);

    const thrown = (await analyzeHackathon(makeInput(), deps).catch(
      (e: unknown) => e,
    )) as ExtractionFailedError;

    expect(thrown.kind).toBe("invalid-output");
    expect(thrown.attempts?.[0]).toMatchObject({ parsed: true, rejectedCount: 11 });
    expect(thrown.attempts?.[0]?.rejected[0]).toEqual({ field: "name", reason: "wrong-shape" });
    expect(thrown.attempts?.[0]).not.toHaveProperty("shape");
  });

  it("GLM-style null field objects do not fail the response and do not trigger the fallback", async () => {
    const deps = makeDeps();
    const raw = validRaw("Meridian") as Record<string, unknown>;
    raw.prizes = { value: null, snippet: null, confidence: 0 };
    const tracked = fakeLlmExtractor([{ raw }]);
    deps.llmExtractor = tracked;

    const result = await analyzeHackathon(makeInput(), deps);

    expect(tracked.calls).toHaveLength(1);
    expect(result.fields.prizes).toBeNull();
  });

  it("copies the extractor's safe parse metadata into each attempt's diagnostics", async () => {
    const deps = makeDeps();
    deps.llmExtractor = fakeLlmExtractor([
      { raw: null, meta: { finishReason: "length", contentLength: 2500, parseFailure: "unterminated" } },
      { raw: null, meta: { finishReason: "stop", contentLength: 0, parseFailure: "no-content" } },
    ]);

    const thrown = (await analyzeHackathon(makeInput(), deps).catch(
      (e: unknown) => e,
    )) as ExtractionFailedError;

    expect(thrown.attempts).toEqual([
      {
        model: "@cf/primary",
        parsed: false,
        rejectedCount: 0,
        rejected: [],
        finishReason: "length",
        contentLength: 2500,
        parseFailure: "unterminated",
      },
      {
        model: "@cf/fallback",
        parsed: false,
        rejectedCount: 0,
        rejected: [],
        finishReason: "stop",
        contentLength: 0,
        parseFailure: "no-content",
      },
    ]);
  });

  it("a timeout failure carries the primary attempt diagnostics only", async () => {
    const deps = makeDeps();
    deps.llmExtractor = fakeLlmExtractor([{ raw: rawWithRejectedCount(6) }]);
    const input = makeInput(CLOCK_START + 10_000);

    const thrown = (await analyzeHackathon(input, deps).catch(
      (e: unknown) => e,
    )) as ExtractionFailedError;

    expect(thrown.kind).toBe("timeout");
    expect(thrown.attempts).toHaveLength(1);
    expect(thrown.attempts?.[0]).toMatchObject({ model: "@cf/primary", parsed: true, rejectedCount: 6 });
  });

  it("a minority rejected (<=half of 11 fields) does not trigger the fallback (RELI-001)", async () => {
    const deps = makeDeps();
    const tracked = fakeLlmExtractor([{ raw: rawWithRejectedCount(2) }]);
    deps.llmExtractor = tracked;

    await analyzeHackathon(makeInput(), deps);

    expect(tracked.calls).toHaveLength(1);
    expect(tracked.calls[0]?.modelId).toBe("@cf/primary");
  });

  describe("analyzeHackathon: attempt deadline (RESI-001)", () => {
    it("skips the fallback and fails with a timeout when less than 50 s remain", async () => {
      const deps = makeDeps();
      const tracked = fakeLlmExtractor([
        { raw: rawWithRejectedCount(6) },
        { raw: validRaw("xxxxx") },
      ]);
      deps.llmExtractor = tracked;

      const thrown: unknown = await analyzeHackathon(
        makeInput(CLOCK_START + 49_999),
        deps,
      ).catch((e: unknown) => e);

      expect(tracked.calls).toHaveLength(1);
      expect(thrown).toBeInstanceOf(ExtractionFailedError);
      expect((thrown as ExtractionFailedError).kind).toBe("timeout");
    });

    it("runs the fallback when exactly 50 s remain", async () => {
      const deps = makeDeps();
      const tracked = fakeLlmExtractor([
        { raw: rawWithRejectedCount(6) },
        { raw: validRaw("xxxxx") },
      ]);
      deps.llmExtractor = tracked;

      await analyzeHackathon(makeInput(CLOCK_START + 50_000), deps);

      expect(tracked.calls).toHaveLength(2);
    });

    it("passes an abort signal to every fetch and model call", async () => {
      const deps = makeDeps({ staticText: "short" });

      await analyzeHackathon(makeInput(), deps);

      expect(deps.staticFetcher.signals[0]).toBeInstanceOf(AbortSignal);
      expect(deps.renderedFetcher.signals[0]).toBeInstanceOf(AbortSignal);
      expect(deps.llmExtractor.calls[0]?.signal).toBeInstanceOf(AbortSignal);
    });
  });
});

describe("analyzeHackathon: builds (does not persist) and suggests", () => {
  // PR5 correction (RELI-001/RESI-001): analyzeHackathon only builds and
  // returns the analysis now — persistence moved to runHackathonJob via
  // AnalysisJobRepo.persistAnalysis (see run-hackathon-job.test.ts).
  it("builds the analysis with a derived slug and token-overlap repo suggestions, without persisting it", async () => {
    const deps = makeDeps();
    deps.repoTopicLinkRepo.rows.push({
      teamId: TEAM_ID,
      repoFullName: "acme/meridian-app" as never,
      orgLogin: "acme",
      threadId: 1,
      createdAt: 0,
      updatedAt: 0,
    });

    const result = await analyzeHackathon(makeInput(), deps);

    expect(result.slug).toBe("meridian");
    expect(result.suggestedRepos).toEqual(["acme/meridian-app"]);
    expect(deps.hackathonAnalysisRepo.rows).toHaveLength(0);
  });

  it("appends a numeric suffix when the derived slug already exists for the team", async () => {
    const deps = makeDeps();
    deps.hackathonAnalysisRepo.rows.push({
      id: "existing-1",
      teamId: TEAM_ID,
      slug: "meridian",
      sourceUrl: "https://example.com/other",
      normalizedUrl: "https://example.com/other",
      fields: {} as never,
      suggestedRepos: [],
      threadId: null,
      pinnedMessageId: null,
      generalMessageId: null,
      createdAt: 0,
      updatedAt: 0,
    });

    const result = await analyzeHackathon(makeInput(), deps);

    expect(result.slug).toBe("meridian-2");
  });

  it("refreshes the existing row in place for a re-analyzed normalized URL", async () => {
    const deps = makeDeps();
    deps.hackathonAnalysisRepo.rows.push({
      id: "existing-1",
      teamId: TEAM_ID,
      slug: "meridian",
      sourceUrl: SOURCE_URL,
      normalizedUrl: NORMALIZED_URL,
      fields: {} as never,
      suggestedRepos: [],
      threadId: 7,
      pinnedMessageId: 42,
      generalMessageId: null,
      createdAt: 10,
      updatedAt: 10,
    });

    const result = await analyzeHackathon(makeInput(), deps);

    expect(result.id).toBe("existing-1");
    expect(result.slug).toBe("meridian");
    expect(result.threadId).toBe(7);
    expect(result.pinnedMessageId).toBe(42);
    // Only the pre-seeded row exists — analyzeHackathon does not write.
    expect(deps.hackathonAnalysisRepo.rows).toHaveLength(1);
  });

  // hackathon-participation: the SQL upsert never writes general_message_id, so
  // the refreshed entity must carry the stored (non-null) id over.
  it("keeps a non-null generalMessageId from the existing row on refresh", async () => {
    const deps = makeDeps();
    deps.hackathonAnalysisRepo.rows.push({
      id: "existing-1",
      teamId: TEAM_ID,
      slug: "meridian",
      sourceUrl: SOURCE_URL,
      normalizedUrl: NORMALIZED_URL,
      fields: {} as never,
      suggestedRepos: [],
      threadId: null,
      pinnedMessageId: null,
      generalMessageId: 321,
      createdAt: 10,
      updatedAt: 10,
    });

    const result = await analyzeHackathon(makeInput(), deps);

    expect(result.id).toBe("existing-1");
    expect(result.generalMessageId).toBe(321);
  });
});
