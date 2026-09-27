import {
  AnalysisBusyError,
  DailyCapReachedError,
  QueueSendFailedError,
  UnauthorizedError,
} from "../errors";
import { NotFoundError } from "../errors";
import type { MembershipId, TeamId } from "../ids";
import type {
  AnalysisJobQueue,
  AnalysisJobRepo,
  AnalysisQuota,
  Clock,
  IdGen,
  Logger,
  MembershipRepo,
} from "../ports";

// spec hackathon-analysis "Daily Cap on Fresh Runs": 5 fetch+LLM runs per
// team per UTC day.
const DAILY_CAP = 5;

// design.md "Lease": 15 min, owned by jobId.
const LEASE_MS = 15 * 60 * 1000;

export interface RequestHackathonAnalysisInput {
  teamId: TeamId;
  actorMembershipId: MembershipId;
  chatId: number;
  threadId: number | null;
  // Already SSRF-guarded (design.md Data Flow: "assertSafeUrl" runs at the
  // caller, before this use case is invoked).
  sourceUrl: string;
}

export interface RequestHackathonAnalysisDeps {
  membershipRepo: MembershipRepo;
  analysisQuota: AnalysisQuota;
  analysisJobQueue: AnalysisJobQueue;
  analysisJobRepo: AnalysisJobRepo;
  clock: Clock;
  idGen: IdGen;
  logger: Logger;
}

export interface RequestHackathonAnalysisResult {
  jobId: string;
  // spec hackathon-analysis "Admin runs a fresh analysis in general chat":
  // "the system immediately replies 'Analyzing <host>…' and returns".
  replyText: string;
}

// design.md "Producer (webhook path, fast)": admin gate, reserve the cap
// slot and lease atomically, enqueue, acknowledge. Busy/cap-reached refuse
// before any reservation; an enqueue failure refunds the slot it already
// reserved (spec: "Enqueue failure").
export async function requestHackathonAnalysis(
  input: RequestHackathonAnalysisInput,
  deps: RequestHackathonAnalysisDeps,
): Promise<RequestHackathonAnalysisResult> {
  const actor = await deps.membershipRepo.get(
    input.teamId,
    input.actorMembershipId,
  );
  if (!actor) {
    throw new NotFoundError("Actor membership not found");
  }
  if (actor.role !== "admin") {
    throw new UnauthorizedError("Only a team admin may analyze a hackathon");
  }

  const now = deps.clock.now();
  const utcDay = utcDayOf(now);
  const jobId = deps.idGen.newId();

  const reserved = await deps.analysisQuota.reserve({
    team: input.teamId,
    day: utcDay,
    cap: DAILY_CAP,
    now,
    leaseMs: LEASE_MS,
    job: {
      id: jobId,
      teamId: input.teamId,
      chatId: input.chatId,
      threadId: input.threadId,
      utcDay,
      fetchUrl: input.sourceUrl,
      createdAt: now,
    },
  });

  if (reserved === "busy") {
    throw new AnalysisBusyError("An analysis is already running for this team");
  }
  if (reserved === "cap-reached") {
    throw new DailyCapReachedError("Daily limit reached (5 new analyses per UTC day)");
  }

  try {
    await deps.analysisJobQueue.enqueue({
      v: 1,
      jobId,
      teamId: input.teamId,
      chatId: input.chatId,
      threadId: input.threadId,
      fetchUrl: input.sourceUrl,
    });
  } catch (err) {
    if (err instanceof QueueSendFailedError) {
      // Best-effort cleanup (RESI-002): each step is guarded independently
      // so a `markFailed` failure never skips `release`, and the original
      // `QueueSendFailedError` — not a cleanup error — is always rethrown.
      try {
        await deps.analysisJobRepo.markFailed(jobId, "enqueue");
      } catch (cleanupErr) {
        // The reserved slot must still be released below (FIXV-001).
        logCleanupFailure(deps.logger, input.teamId, cleanupErr, "mark-failed-failed");
      }
      try {
        await deps.analysisQuota.release(input.teamId, utcDay, jobId, true);
      } catch (cleanupErr) {
        // The original enqueue failure still wins below (FIXV-001).
        logCleanupFailure(deps.logger, input.teamId, cleanupErr, "release-failed");
      }
    }
    throw err;
  }

  const host = new URL(input.sourceUrl).hostname;
  return { jobId, replyText: `Analyzing ${host}… the result will be posted here.` };
}

function utcDayOf(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

// A swallowed cleanup failure stays observable (FIXV-001). Only the error
// class name is logged, never its message.
function logCleanupFailure(
  logger: Logger,
  teamId: TeamId,
  err: unknown,
  reason: "mark-failed-failed" | "release-failed",
): void {
  logger.log({
    event: "hackathon-enqueue-cleanup",
    teamId,
    outcome: "error",
    errorCode: err instanceof Error ? err.name : "UnknownError",
    reason,
  });
}
