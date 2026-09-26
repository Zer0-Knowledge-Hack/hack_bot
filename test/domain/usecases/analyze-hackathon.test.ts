import { describe, expect, it } from "vitest";
import { analyzeHackathon } from "../../../src/domain/usecases/analyze-hackathon";
import { BrowserQuotaExceededError, PageTooThinError } from "../../../src/domain/errors";
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

// snippet is "" (always verbatim-in-page, see extraction.ts's
// sanitizeField) so this fixture works against any fake page text.
const VALID_RAW = {
  name: { value: "Meridian", snippet: "", confidence: 0.9 },
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
  const llmExtractor = fakeLlmExtractor([{ raw: VALID_RAW }]);
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

function makeInput() {
  return {
    teamId: TEAM_ID,
    sourceUrl: SOURCE_URL,
    normalizedUrl: NORMALIZED_URL,
    primaryModel: "@cf/primary",
    fallbackModel: "@cf/fallback",
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
    const tracked = fakeLlmExtractor([{ raw: VALID_RAW }]);
    deps.llmExtractor = tracked;

    await analyzeHackathon(makeInput(), deps);

    expect(tracked.calls).toHaveLength(1);
    expect(tracked.calls[0]?.modelId).toBe("@cf/primary");
  });

  it("falls back to the fallback model when the primary output fails validation", async () => {
    const deps = makeDeps();
    const tracked = fakeLlmExtractor([
      { raw: { not: "valid" } },
      { raw: VALID_RAW },
    ]);
    deps.llmExtractor = tracked;

    const result = await analyzeHackathon(makeInput(), deps);

    expect(tracked.calls).toHaveLength(2);
    expect(tracked.calls[1]?.modelId).toBe("@cf/fallback");
    expect(result.fields.name?.value).toBe("Meridian");
  });
});

describe("analyzeHackathon: persist and suggestions", () => {
  it("persists the analysis with a derived slug and token-overlap repo suggestions", async () => {
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
    expect(deps.hackathonAnalysisRepo.rows).toHaveLength(1);
    expect(deps.hackathonAnalysisRepo.rows[0]?.slug).toBe("meridian");
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
      createdAt: 10,
      updatedAt: 10,
    });

    const result = await analyzeHackathon(makeInput(), deps);

    expect(result.id).toBe("existing-1");
    expect(result.slug).toBe("meridian");
    expect(result.threadId).toBe(7);
    expect(deps.hackathonAnalysisRepo.rows).toHaveLength(1);
  });
});
