import type {
  AnalysisJob,
  AnalysisJobStatus,
  ClaimResult,
  HackathonAnalysis,
} from "../../domain/entities";
import { asTeamId } from "../../domain/ids";
import type { Clock } from "../../domain/ports";
import type { AnalysisJobRepo } from "../../domain/ports";

// design.md "Claim": `claim_until = now + 240s`. Exported so the queue
// redelivery window can be checked against it (R4-001).
export const CLAIM_MS = 240_000;

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

    // RELI-001/RESI-001 correction: the analysis upsert (same SQL as
    // createD1HackathonAnalysisRepo.save) and the job's persisted
    // transition run in ONE db.batch, so a crash between them is
    // impossible (design.md "persist+mark (one batch)"). The guard is
    // embedded in the SQL itself rather than a pre-read check, so the whole
    // decision stays inside the same atomic batch: the analysis row's
    // `INSERT ... SELECT ... WHERE EXISTS (job is running)` inserts/updates
    // nothing when the job is not running, and the job UPDATE's own
    // `AND status = 'running'` guard reports 0 changed rows in that case —
    // both driven by the SAME job-status predicate, evaluated atomically.
    async persistAnalysis(jobId: string, analysis: HackathonAnalysis): Promise<boolean> {
      const now = clock.now();
      const results = await db.batch([
        db
          .prepare(
            `INSERT INTO hackathon_analyses
              (id, team_id, slug, source_url, normalized_url, fields, suggested_repos,
               thread_id, pinned_message_id, created_at, updated_at)
             SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
             WHERE EXISTS (
               SELECT 1 FROM hackathon_analysis_jobs WHERE id = ? AND status = 'running'
             )
             ON CONFLICT (id) DO UPDATE SET
               slug = excluded.slug,
               source_url = excluded.source_url,
               normalized_url = excluded.normalized_url,
               fields = excluded.fields,
               suggested_repos = excluded.suggested_repos,
               thread_id = excluded.thread_id,
               pinned_message_id = excluded.pinned_message_id,
               updated_at = excluded.updated_at`,
          )
          .bind(
            analysis.id,
            analysis.teamId,
            analysis.slug,
            analysis.sourceUrl,
            analysis.normalizedUrl,
            JSON.stringify(analysis.fields),
            JSON.stringify(analysis.suggestedRepos),
            analysis.threadId,
            analysis.pinnedMessageId,
            analysis.createdAt,
            analysis.updatedAt,
            jobId,
          ),
        db
          .prepare(
            `UPDATE hackathon_analysis_jobs
              SET status = 'persisted', analysis_id = ?, updated_at = ?
              WHERE id = ? AND status = 'running'`,
          )
          .bind(analysis.id, now, jobId),
      ]);
      return results.at(1)?.meta.changes === 1;
    },

    async markSucceeded(id: string): Promise<void> {
      await db
        .prepare(
          // Only a persisted job can succeed, so a late attempt can never
          // overwrite a job another delivery already failed (FIXV-001).
          "UPDATE hackathon_analysis_jobs SET status = 'succeeded', updated_at = ? WHERE id = ? AND status = 'persisted'",
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
