import type { AnalysisJob, AnalysisJobStatus, ClaimResult } from "../../domain/entities";
import { asTeamId } from "../../domain/ids";
import type { Clock } from "../../domain/ports";
import type { AnalysisJobRepo } from "../../domain/ports";

// design.md "Claim": `claim_until = now + 240s`.
const CLAIM_MS = 240_000;

interface JobRow {
  id: string;
  team_id: string;
  chat_id: number;
  thread_id: number | null;
  utc_day: string;
  fetch_url: string;
  status: AnalysisJobStatus;
  attempts: number;
  claim_until: number;
  analysis_id: string | null;
  failure_reason: string | null;
  created_at: number;
  updated_at: number;
}

function rowToJob(row: JobRow): AnalysisJob {
  return {
    id: row.id,
    teamId: asTeamId(row.team_id),
    chatId: row.chat_id,
    threadId: row.thread_id,
    utcDay: row.utc_day,
    fetchUrl: row.fetch_url,
    status: row.status,
    attempts: row.attempts,
    claimUntil: row.claim_until,
    analysisId: row.analysis_id,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// design.md "Job State (D1) and Idempotency". `clock` supplies `updated_at`
// for the terminal/persist transitions (the port's own methods take no
// `now` — only `claim` does), matching the constructor-injected Clock
// convention used by the other D1 repos (e.g. createD1MembershipRepo).
export function createD1AnalysisJobRepo(db: D1Database, clock: Clock): AnalysisJobRepo {
  return {
    async claim(id: string, now: number): Promise<ClaimResult> {
      const claimUntil = now + CLAIM_MS;
      const updateResult = await db
        .prepare(
          `UPDATE hackathon_analysis_jobs
            SET status = 'running', claim_until = ?, attempts = attempts + 1, updated_at = ?
            WHERE id = ? AND (status = 'queued' OR (status = 'running' AND claim_until < ?))`,
        )
        .bind(claimUntil, now, id, now)
        .run();

      if (updateResult.meta.changes === 1) {
        const row = await db
          .prepare("SELECT * FROM hackathon_analysis_jobs WHERE id = ?")
          .bind(id)
          .first<JobRow>();
        // The row existed a moment ago (the UPDATE matched it) — this
        // should be unreachable, but never fabricate a job.
        return row ? { kind: "claimed", job: rowToJob(row) } : { kind: "missing" };
      }

      // The UPDATE matched no row: classify by reading the current state.
      const row = await db
        .prepare("SELECT * FROM hackathon_analysis_jobs WHERE id = ?")
        .bind(id)
        .first<JobRow>();
      if (!row) return { kind: "missing" };
      if (row.status === "succeeded" || row.status === "failed") {
        return { kind: "terminal" };
      }
      if (row.status === "persisted") {
        return { kind: "persisted", job: rowToJob(row) };
      }
      // status === "running" with an unexpired claim_until.
      return { kind: "held" };
    },

    async markPersisted(id: string, analysisId: string): Promise<void> {
      await db
        .prepare(
          "UPDATE hackathon_analysis_jobs SET status = 'persisted', analysis_id = ?, updated_at = ? WHERE id = ?",
        )
        .bind(analysisId, clock.now(), id)
        .run();
    },

    async markSucceeded(id: string): Promise<void> {
      await db
        .prepare(
          "UPDATE hackathon_analysis_jobs SET status = 'succeeded', updated_at = ? WHERE id = ?",
        )
        .bind(clock.now(), id)
        .run();
    },

    async markFailed(id: string, reason: string): Promise<void> {
      await db
        .prepare(
          "UPDATE hackathon_analysis_jobs SET status = 'failed', failure_reason = ?, updated_at = ? WHERE id = ?",
        )
        .bind(reason, clock.now(), id)
        .run();
    },
  };
}
