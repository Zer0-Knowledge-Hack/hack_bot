import {
  BrowserQuotaExceededError,
  ExtractionFailedError,
  PageTooThinError,
} from "../errors";
import { deriveBaseSlug, slugForAttempt } from "../hackathon/slug";
import { suggestRepos } from "../hackathon/suggest";
import {
  FIELD_COUNT,
  validateExtraction,
  type ExtractedFields,
  type ValidateExtractionResult,
} from "../hackathon/extraction";
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

// design.md "Time budget": per-step caps inside the attempt deadline, and
// the fallback LLM call runs only when at least this much time remains.
const STATIC_FETCH_TIMEOUT_MS = 10_000;
const RENDERED_FETCH_TIMEOUT_MS = 45_000;
const LLM_ATTEMPT_TIMEOUT_MS = 45_000;
const MIN_REMAINING_FOR_FALLBACK_MS = 50_000;

// A step never runs past the attempt deadline, even when its own cap is
// longer than the time left.
function stepSignal(stepMs: number, deadlineAt: number, clock: Clock): AbortSignal {
  const remaining = Math.max(0, deadlineAt - clock.now());
  return AbortSignal.timeout(Math.min(stepMs, remaining));
}

export interface AnalyzeHackathonInput {
  teamId: TeamId;
  // The already SSRF-guarded URL string (design.md: the guard runs at the
  // producer and again on every fetcher redirect/sub-request — this use
  // case does not re-guard it).
  sourceUrl: string;
  normalizedUrl: string;
  primaryModel: string;
  fallbackModel: string;
  // Absolute epoch-ms attempt deadline (design.md "Time budget: a 180 s
  // attempt deadline"). An absolute instant, rather than a duration, fits
  // the existing `Clock.now()` port directly — no extra port method is
  // needed to compute "time remaining" (RESI-001).
  deadlineAt: number;
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
  const pageText = await resolvePageText(input.sourceUrl, input.deadlineAt, deps);

  const fields = await extractFields(pageText, input, deps);

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
    pinnedMessageId: existing?.pinnedMessageId ?? null,
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
  deadlineAt: number,
  deps: Pick<AnalyzeHackathonDeps, "staticFetcher" | "renderedFetcher" | "clock">,
): Promise<string> {
  const staticText = await deps.staticFetcher.fetch(
    sourceUrl,
    stepSignal(STATIC_FETCH_TIMEOUT_MS, deadlineAt, deps.clock),
  );
  if (staticText.length >= THIN_STATIC_TEXT_THRESHOLD) {
    return staticText;
  }

  try {
    return await deps.renderedFetcher.fetch(
      sourceUrl,
      stepSignal(RENDERED_FETCH_TIMEOUT_MS, deadlineAt, deps.clock),
    );
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

// design.md "Extraction Schema and Prompt": "The fallback model is tried
// when the output is unparseable or more than half of its fields are
// invalid." A result is usable when it validated AND is not
// majority-rejected; "invalid" here means content-validation rejections
// (extraction.ts's rejectedCount), never fields the model itself returned
// as null.
const MAJORITY_REJECTED_THRESHOLD = Math.floor(FIELD_COUNT / 2);

function isUsable(
  result: ValidateExtractionResult,
): result is Extract<ValidateExtractionResult, { ok: true }> {
  return result.ok && result.rejectedCount <= MAJORITY_REJECTED_THRESHOLD;
}

function rejectedCountOf(result: ValidateExtractionResult): number {
  return result.ok ? result.rejectedCount : FIELD_COUNT;
}

// design.md "Validation": at most 2 model calls (primary, then fallback).
// The fallback only runs with at least 50 s left (design.md "Time budget").
async function extractFields(
  pageText: string,
  input: Pick<AnalyzeHackathonInput, "primaryModel" | "fallbackModel" | "deadlineAt">,
  deps: Pick<AnalyzeHackathonDeps, "llmExtractor" | "clock">,
): Promise<ExtractedFields> {
  const { llmExtractor, clock } = deps;
  const primaryRaw = await llmExtractor.extract(
    pageText,
    input.primaryModel,
    stepSignal(LLM_ATTEMPT_TIMEOUT_MS, input.deadlineAt, clock),
  );
  const primary = validateExtraction(primaryRaw, pageText);
  if (isUsable(primary)) return primary.fields;

  if (input.deadlineAt - clock.now() < MIN_REMAINING_FOR_FALLBACK_MS) {
    throw new ExtractionFailedError(
      "Primary model output was unusable and too little time remains for the fallback",
      "timeout",
    );
  }

  const fallbackRaw = await llmExtractor.extract(
    pageText,
    input.fallbackModel,
    stepSignal(LLM_ATTEMPT_TIMEOUT_MS, input.deadlineAt, clock),
  );
  const fallback = validateExtraction(fallbackRaw, pageText);

  // "Use the fallback result when it is better": prefer whichever attempt
  // rejected fewer fields, then check that the better one clears the
  // majority-rejected bar.
  const better = rejectedCountOf(fallback) <= rejectedCountOf(primary) ? fallback : primary;
  if (isUsable(better)) return better.fields;

  throw new ExtractionFailedError(
    "Both the primary and fallback model produced too many invalid fields",
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
