import {
  BrowserQuotaExceededError,
  ExtractionFailedError,
  PageTooThinError,
} from "../errors";
import { deriveBaseSlug, slugForAttempt } from "../hackathon/slug";
import { suggestRepos } from "../hackathon/suggest";
import { validateExtraction } from "../hackathon/extraction";
import type { HackathonAnalysis } from "../entities";
import type { RepoFullName } from "../github";
import type { TeamId } from "../ids";
import type {
  Clock,
  HackathonAnalysisRepo,
  IdGen,
  LlmExtractor,
  PageFetcher,
  RepoTopicLinkRepo,
} from "../ports";

// design.md "Fallback policy": below this many chars of static text, the
// rendered (browser) fetch is tried (spec page-fetch: "Browser Rendering
// Fallback on Thin Static Text").
const THIN_STATIC_TEXT_THRESHOLD = 800;

// spec page-fetch "Browser Rendering Quota Exhaustion Degrades or Fails
// Based on Static Text Length": the floor above which a 429 degrades to
// the static text instead of failing.
const MIN_USABLE_TEXT_ON_QUOTA_DEGRADE = 200;

// design.md "Slug": collisions get -2..-99, then a random hex suffix. A
// random suffix generator is not exercised in PR2 (no test drives past 99
// collisions); attempt 100 is a placeholder until a real IdGen-backed hex
// generator is wired in (deferred — see apply-progress deviations).
const MAX_NUMERIC_SLUG_ATTEMPT = 99;

export interface AnalyzeHackathonInput {
  teamId: TeamId;
  // The already SSRF-guarded URL string (design.md: the guard runs at the
  // producer and again on every fetcher redirect/sub-request — this use
  // case does not re-guard it).
  sourceUrl: string;
  normalizedUrl: string;
  primaryModel: string;
  fallbackModel: string;
}

export interface AnalyzeHackathonDeps {
  staticFetcher: PageFetcher;
  renderedFetcher: PageFetcher;
  llmExtractor: LlmExtractor;
  hackathonAnalysisRepo: HackathonAnalysisRepo;
  repoTopicLinkRepo: RepoTopicLinkRepo;
  clock: Clock;
  idGen: IdGen;
}

// Pure orchestration of the fetch -> browser fallback -> LLM extraction ->
// validation -> persist -> suggestions pipeline (design.md "Data Flow").
// Callers (runHackathonJob, PR3) map any thrown error to the fixed user
// reply and job outcome in design.md's "Error Taxonomy".
export async function analyzeHackathon(
  input: AnalyzeHackathonInput,
  deps: AnalyzeHackathonDeps,
): Promise<HackathonAnalysis> {
  const pageText = await resolvePageText(input.sourceUrl, deps);

  const fields = await extractFields(pageText, input, deps.llmExtractor);

  const existing = await deps.hackathonAnalysisRepo.findByNormalizedUrl(
    input.teamId,
    input.normalizedUrl,
  );

  const slug = existing
    ? existing.slug
    : await deriveUniqueSlug(
        input.teamId,
        fields.name?.value ?? new URL(input.sourceUrl).hostname,
        deps.hackathonAnalysisRepo,
        deps.idGen,
      );

  const existingLinks = await deps.repoTopicLinkRepo.list(input.teamId);
  const repoNames = existingLinks.map((link) => link.repoFullName as string);
  const suggestedRepos = suggestRepos(
    fields.name?.value ?? "",
    repoNames,
  ) as RepoFullName[];

  const now = deps.clock.now();
  const analysis: HackathonAnalysis = {
    id: existing?.id ?? deps.idGen.newId(),
    teamId: input.teamId,
    slug,
    sourceUrl: input.sourceUrl,
    normalizedUrl: input.normalizedUrl,
    fields,
    suggestedRepos,
    threadId: existing?.threadId ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  await deps.hackathonAnalysisRepo.save(analysis);

  return analysis;
}

// spec page-fetch "Browser Rendering Fallback on Thin Static Text" and
// "Browser Rendering Quota Exhaustion Degrades or Fails Based on Static
// Text Length". A static-fetch failure (SSRF guard, size/time cap)
// propagates as-is — the fallback is only attempted for THIN text, never
// for a failed fetch.
async function resolvePageText(
  sourceUrl: string,
  deps: Pick<AnalyzeHackathonDeps, "staticFetcher" | "renderedFetcher">,
): Promise<string> {
  const staticText = await deps.staticFetcher.fetch(sourceUrl);
  if (staticText.length >= THIN_STATIC_TEXT_THRESHOLD) {
    return staticText;
  }

  try {
    return await deps.renderedFetcher.fetch(sourceUrl);
  } catch (err) {
    if (err instanceof BrowserQuotaExceededError) {
      if (staticText.length >= MIN_USABLE_TEXT_ON_QUOTA_DEGRADE) {
        return staticText;
      }
      throw new PageTooThinError(
        "Browser Rendering quota exhausted and the static text is too thin",
        true,
      );
    }
    throw err;
  }
}

// design.md "Validation": at most 2 model calls (primary, then fallback).
async function extractFields(
  pageText: string,
  input: Pick<AnalyzeHackathonInput, "primaryModel" | "fallbackModel">,
  llmExtractor: LlmExtractor,
) {
  const primaryRaw = await llmExtractor.extract(pageText, input.primaryModel);
  const primary = validateExtraction(primaryRaw, pageText);
  if (primary.ok) return primary.fields;

  const fallbackRaw = await llmExtractor.extract(pageText, input.fallbackModel);
  const fallback = validateExtraction(fallbackRaw, pageText);
  if (fallback.ok) return fallback.fields;

  throw new ExtractionFailedError(
    "Both the primary and fallback model produced an invalid response",
    "invalid-output",
  );
}

// spec hackathon-analysis "Slug Generation and Uniqueness" — wires the
// pure slug.ts helpers to a real collision check.
async function deriveUniqueSlug(
  teamId: TeamId,
  nameOrHost: string,
  hackathonAnalysisRepo: HackathonAnalysisRepo,
  idGen: IdGen,
): Promise<string> {
  const base = deriveBaseSlug(nameOrHost);
  for (let attempt = 1; attempt <= MAX_NUMERIC_SLUG_ATTEMPT; attempt++) {
    const candidate = slugForAttempt(base, attempt, "");
    if (!(await hackathonAnalysisRepo.slugExists(teamId, candidate))) {
      return candidate;
    }
  }
  // design.md "Slug": attempt 100+ falls back to a random hex suffix
  // supplied by the caller, never generated by the pure slug.ts module.
  // Reuses the injected IdGen instead of calling crypto directly, so this
  // use case stays deterministic under test (no RED test exercises this
  // branch — 99 prior collisions for one team is not a realistic case).
  return slugForAttempt(base, MAX_NUMERIC_SLUG_ATTEMPT + 1, idGen.newId().slice(0, 6));
}
