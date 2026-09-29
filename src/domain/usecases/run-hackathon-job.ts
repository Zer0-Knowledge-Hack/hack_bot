import {
  ConfigError,
  ExtractionFailedError,
  LlmQuotaExceededError,
  PageFetchFailedError,
  PageTooThinError,
  PublishFailedError,
  UnsafeUrlError,
} from "../errors";
import { analysisCopy, FETCH_FAILURE_PHRASES } from "../copy";
import { formatAnalysis } from "../hackathon/format";
import { normalizeUrlKey } from "../hackathon/url";
import type { AnalysisJob, AnalysisJobMessage, HackathonAnalysis, JobOutcome } from "../entities";
import { analyzeHackathon, type AnalyzeHackathonDeps } from "./analyze-hackathon";
import { postAnalysisAndLinkTopic } from "./link-analysis-to-topic";
import type { AnalysisJobRepo, AnalysisQuota, ChatPublisher, Logger } from "../ports";

// design.md "Time budget (per consumer attempt)": 180 s.
const ATTEMPT_BUDGET_MS = 180_000;
// design.md "Stale": a queued job older than 1 h is failed as expired.
const STALE_JOB_MS = 60 * 60 * 1000;
// design.md "Retries": this use case retries transient failures up to 3
// deliveries, independent of the queue `max_retries` (5, sized for held
// claims; see test/config/queue-retry-window.test.ts).
const MAX_ATTEMPTS = 3;
// A held claim (another delivery still owns the lease) is retried after this
// delay. Exported so the queue redelivery window can be checked against the
// claim lease (R4-001).
export const HELD_RETRY_DELAY_S = 60;
// Exported as the single source of truth for the transient retry cadence:
// the queue entry point (`src/index.ts`) reuses it for unexpected failures.
export const TRANSIENT_RETRY_DELAY_S = 30;

export interface RunHackathonJobDeps extends AnalyzeHackathonDeps {
  analysisJobRepo: AnalysisJobRepo;
  analysisQuota: AnalysisQuota;
  chatPublisher: ChatPublisher;
  logger: Logger;
  primaryModel: string;
  fallbackModel: string;
}

// design.md "Interfaces / Contracts": pure — `src/index.ts` (PR9) maps this
// result to `msg.ack()`/`msg.retry()` and never throws. `attempt` is the
// queue's own delivery counter (unrelated to `AnalysisJob.attempts`, which
// `claim` maintains in D1); it drives the transient-error retry limit
// without a D1 round trip.
export async function runHackathonJob(
  msg: AnalysisJobMessage,
  attempt: number,
  deps: RunHackathonJobDeps,
): Promise<JobOutcome> {
  const claim = await deps.analysisJobRepo.claim(msg.jobId, deps.clock.now());

  switch (claim.kind) {
    case "terminal":
    case "missing":
      return { kind: "ack" };
    case "held":
      return { kind: "retry", delaySeconds: HELD_RETRY_DELAY_S };
    case "persisted":
      return postPersistedResult(claim.job, attempt, deps);
    case "claimed":
      return runClaimedJob(claim.job, attempt, deps);
  }
}

async function postPersistedResult(
  job: AnalysisJob,
  attempt: number,
  deps: RunHackathonJobDeps,
): Promise<JobOutcome> {
  // RELI-002: repost the exact analysis this job produced (by id), never
  // re-derive it by URL — a same-team same-URL refresh could otherwise
  // repost the wrong (newer) row.
  const analysis = job.analysisId
    ? await deps.hackathonAnalysisRepo.findById(job.teamId, job.analysisId)
    : null;
  if (!analysis) {
    // The persisted analysis is missing: this is a permanent failure, not
    // a silent success — post then mark (design.md "Post then mark ...
    // never silence").
    await safePost(job, analysisCopy.missingAnalysis, deps);
    await deps.analysisJobRepo.markFailed(job.id, "job:missing-analysis");
    await deps.analysisQuota.release(job.teamId, job.utcDay, job.id, false);
    return { kind: "ack" };
  }

  try {
    // RELI-001/RESI-002: a redelivered persisted job with a threadId must
    // use the same link+pin completion as a fresh run, not a bare post —
    // otherwise the topic link/pin is silently lost on redelivery.
    // `postAnalysisAndLinkTopic` is idempotent for the SAME analysis id
    // already occupying that topic (no self-unpin/unlink/moved note).
    if (job.threadId !== null) {
      await postAnalysisAndLinkTopic(
        { teamId: job.teamId, chatId: job.chatId, threadId: job.threadId, analysis },
        deps,
      );
    } else {
      await postToGeneral(job, analysis, deps);
    }
  } catch (err) {
    // RESI-001: postPersistedResult must never throw out of
    // runHackathonJob — route through the same transient-retry /
    // final-failure classification runClaimedJob uses.
    return handleJobError(err, job, attempt, deps);
  }

  await deps.analysisJobRepo.markSucceeded(job.id);
  await deps.analysisQuota.release(job.teamId, job.utcDay, job.id, false);
  return { kind: "ack" };
}

async function runClaimedJob(
  job: AnalysisJob,
  attempt: number,
  deps: RunHackathonJobDeps,
): Promise<JobOutcome> {
  // design.md "Stale": only a job that never started running (its first
  // claim) can be stale — no neurons were spent yet.
  if (job.attempts <= 1 && deps.clock.now() - job.createdAt > STALE_JOB_MS) {
    // Post then mark (design.md "Post then mark ... never silence"): a
    // crash after this point yields at most a duplicate expiry reply on
    // redelivery, never silence.
    await safePost(job, analysisCopy.expired, deps);
    await deps.analysisJobRepo.markFailed(job.id, "job:expired");
    await deps.analysisQuota.release(job.teamId, job.utcDay, job.id, true);
    return { kind: "ack" };
  }

  try {
    // R4-001: unset models are a config failure classified below (reply,
    // refund, markFailed, ack), not a transient error to retry.
    if (!deps.primaryModel || !deps.fallbackModel) {
      throw new ConfigError("HACKATHON_MODEL_PRIMARY and HACKATHON_MODEL_FALLBACK must be set");
    }
    const deadlineAt = deps.clock.now() + ATTEMPT_BUDGET_MS;
    const analysis = await analyzeHackathon(
      {
        teamId: job.teamId,
        sourceUrl: job.fetchUrl,
        normalizedUrl: normalizeUrlKey(new URL(job.fetchUrl)),
        primaryModel: deps.primaryModel,
        fallbackModel: deps.fallbackModel,
        deadlineAt,
      },
      deps,
    );
    // RELI-001/RESI-001 (PR5 correction): persist the analysis and mark the
    // job persisted atomically (design.md "persist+mark (one batch)").
    const persisted = await deps.analysisJobRepo.persistAnalysis(job.id, analysis);
    if (!persisted) {
      // FIXV-001: the job is no longer `running` — this attempt outlived its
      // claim and another delivery already owns (or finished) the job. Nothing
      // was saved, so post nothing, leave its status and lease alone, and ack.
      deps.logger.log({
        event: "hackathon-job",
        teamId: job.teamId,
        outcome: "refused",
        reason: "claim-lost",
      });
      return { kind: "ack" };
    }
    // task 4.6 / design.md "Pin Behavior": a fresh run inside a topic links
    // and pins from the consumer instead of a bare post (RELI-003). The
    // producer already gated this on an admin (requestHackathonAnalysis),
    // so no acting membership is needed here.
    if (job.threadId !== null) {
      await postAnalysisAndLinkTopic(
        { teamId: job.teamId, chatId: job.chatId, threadId: job.threadId, analysis },
        deps,
      );
    } else {
      await postToGeneral(job, analysis, deps);
    }
    await deps.analysisJobRepo.markSucceeded(job.id);
    await deps.analysisQuota.release(job.teamId, job.utcDay, job.id, false);
    return { kind: "ack" };
  } catch (err) {
    return handleJobError(err, job, attempt, deps);
  }
}

// hackathon-participation: the General post carries the participation button
// (a topic post never does) and its message id is stored so the button can be
// removed later. The store is best-effort: the post already went out, so a
// failure here must not fail the job (a retry would repost the analysis). The
// only cost is that the stored message's button is not cleared on join; the
// tapped message's own button still is.
async function postToGeneral(
  job: AnalysisJob,
  analysis: HackathonAnalysis,
  deps: RunHackathonJobDeps,
): Promise<void> {
  const messageId = await deps.chatPublisher.post(
    job.chatId,
    null,
    formatAnalysis({
      slug: analysis.slug,
      fields: analysis.fields,
      suggestions: analysis.suggestedRepos,
    }),
    { participateSlug: analysis.slug },
  );
  try {
    await deps.hackathonAnalysisRepo.setGeneralMessageId(job.teamId, analysis.id, messageId);
  } catch (err) {
    deps.logger.log({
      event: "hackathon-job",
      teamId: job.teamId,
      outcome: "error",
      errorCode: err instanceof Error ? err.name : "UnknownError",
      reason: "general-message-id-store-failed",
    });
  }
}

interface JobErrorClassification {
  transient: boolean;
  refund: boolean;
  reason: string;
  reply: string | null;
}

// design.md "Error Taxonomy": maps each thrown error to its reason code,
// user reply and whether the reserved cap slot is refunded. Anything not
// named here (D1, an unclassified `PublishFailedError`, or an unknown
// error) is transient and retried up to `MAX_ATTEMPTS`.
function classifyJobError(err: unknown): JobErrorClassification {
  if (err instanceof UnsafeUrlError) {
    return {
      transient: false,
      refund: false,
      reason: `unsafe-url:${err.reason}`,
      reply: analysisCopy.unsafeUrl,
    };
  }
  if (err instanceof PageFetchFailedError) {
    return {
      transient: false,
      refund: false,
      reason: `fetch:${err.kind}`,
      reply: analysisCopy.fetchFailed(FETCH_FAILURE_PHRASES[err.kind]),
    };
  }
  if (err instanceof PageTooThinError) {
    return {
      transient: false,
      refund: false,
      reason: `fetch:too-thin${err.browserQuotaDegraded ? "-browser-quota" : ""}`,
      reply: analysisCopy.tooThin,
    };
  }
  if (err instanceof LlmQuotaExceededError) {
    return {
      transient: false,
      refund: false,
      reason: "llm:quota",
      reply: analysisCopy.quota,
    };
  }
  if (err instanceof ExtractionFailedError) {
    return {
      transient: false,
      refund: false,
      reason: `llm:${err.kind}`,
      reply: analysisCopy.invalidOutput,
    };
  }
  if (err instanceof ConfigError) {
    return {
      transient: false,
      refund: true,
      reason: "config",
      reply: analysisCopy.notConfigured,
    };
  }
  if (
    err instanceof PublishFailedError &&
    (err.failureClass === "rejected" || err.failureClass === "thread-gone")
  ) {
    return { transient: false, refund: false, reason: "publish:rejected", reply: null };
  }
  const name = err instanceof Error ? err.name : "unknown";
  return {
    transient: true,
    refund: false,
    reason: `job:transient:${name}`,
    reply: analysisCopy.transient,
  };
}

async function handleJobError(
  err: unknown,
  job: AnalysisJob,
  attempt: number,
  deps: RunHackathonJobDeps,
): Promise<JobOutcome> {
  const classification = classifyJobError(err);
  if (classification.transient && attempt < MAX_ATTEMPTS) {
    return { kind: "retry", delaySeconds: TRANSIENT_RETRY_DELAY_S };
  }
  // Observability: the final failure is logged with its reason code and,
  // for a failed page fetch, the HTTP status (never the URL, body or message).
  deps.logger.log({
    event: "hackathon-job",
    teamId: job.teamId,
    outcome: "error",
    errorCode: err instanceof Error ? err.name : "UnknownError",
    reason: classification.reason,
    ...(err instanceof PageFetchFailedError && err.status !== undefined
      ? { httpStatus: err.status }
      : {}),
    ...(err instanceof ExtractionFailedError && err.attempts !== undefined
      ? { attempts: err.attempts }
      : {}),
  });
  // Post then mark (design.md "Post then mark ... never silence"): a crash
  // after this point yields at most a duplicate failure reply on
  // redelivery, never silence.
  await safePost(job, classification.reply, deps);
  await deps.analysisJobRepo.markFailed(job.id, classification.reason);
  await deps.analysisQuota.release(job.teamId, job.utcDay, job.id, classification.refund);
  return { kind: "ack" };
}

// Best-effort: a failure reply that itself fails to send must not crash the
// handler or re-enter error classification, but it must stay observable
// (FIXV-001). Only the error class name is logged, never its message.
async function safePost(
  job: AnalysisJob,
  text: string | null,
  deps: Pick<RunHackathonJobDeps, "chatPublisher" | "logger">,
): Promise<void> {
  if (text === null) return;
  try {
    await deps.chatPublisher.post(job.chatId, job.threadId, text);
  } catch (err) {
    deps.logger.log({
      event: "hackathon-job",
      teamId: job.teamId,
      outcome: "error",
      errorCode: err instanceof Error ? err.name : "UnknownError",
      reason: "failure-reply-failed",
    });
  }
}
