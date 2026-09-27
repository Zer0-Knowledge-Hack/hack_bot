import type { NewAnalysisJob } from "../../domain/entities";
import type { TeamId } from "../../domain/ids";
import type { AnalysisQuota } from "../../domain/ports";

interface UsageRow {
  runs: number;
  lease_until: number;
}

// design.md "reserve": one atomic `db.batch` reserves the cap slot and the
// team lease together with the job insert, so a redelivery cannot
// double-count (design.md "Cap and lease"). `release` is owner-checked by
// `jobId`.
export function createD1AnalysisQuota(db: D1Database): AnalysisQuota {
  return {
    async reserve(input: {
      team: TeamId;
      day: string;
      cap: number;
      now: number;
      leaseMs: number;
      job: NewAnalysisJob;
    }): Promise<"ok" | "busy" | "cap-reached"> {
      const { team, day, cap, now, leaseMs, job } = input;
      const leaseUntil = now + leaseMs;

      // Statement 1: upsert the usage row. A no-op (the WHERE clause fails)
      // when the cap is already reached or an unexpired lease is held by a
      // DIFFERENT job — `lease_job_id` then still names the current owner.
      const usageStmt = db
        .prepare(
          `INSERT INTO hackathon_analysis_usage (team_id, utc_day, runs, lease_until, lease_job_id)
           VALUES (?, ?, 1, ?, ?)
           ON CONFLICT (team_id, utc_day) DO UPDATE SET
             runs = runs + 1,
             lease_until = excluded.lease_until,
             lease_job_id = excluded.lease_job_id
           WHERE runs < ? AND lease_until < ?`,
        )
        .bind(team, day, leaseUntil, job.id, cap, now);

      // Statement 2: only inserts the job row when statement 1 actually
      // applied FOR THIS job (checked via `lease_job_id`, not row
      // existence — a losing reserve must not create a job row at all).
      const jobStmt = db
        .prepare(
          `INSERT INTO hackathon_analysis_jobs
            (id, team_id, chat_id, thread_id, utc_day, fetch_url, status, attempts, claim_until, analysis_id, failure_reason, created_at, updated_at)
           SELECT ?, ?, ?, ?, ?, ?, 'queued', 0, 0, NULL, NULL, ?, ?
           WHERE EXISTS (
             SELECT 1 FROM hackathon_analysis_usage
             WHERE team_id = ? AND utc_day = ? AND lease_job_id = ?
           )`,
        )
        .bind(
          job.id,
          job.teamId,
          job.chatId,
          job.threadId,
          job.utcDay,
          job.fetchUrl,
          job.createdAt,
          job.createdAt,
          team,
          day,
          job.id,
        );

      const [, jobResult] = await db.batch([usageStmt, jobStmt]);
      if ((jobResult?.meta.changes ?? 0) === 1) {
        return "ok";
      }

      // The job insert changed no row: classify busy vs cap-reached from
      // the current usage row (design.md "reserve").
      const usage = await db
        .prepare("SELECT runs, lease_until FROM hackathon_analysis_usage WHERE team_id = ? AND utc_day = ?")
        .bind(team, day)
        .first<UsageRow>();
      if (usage && usage.lease_until >= now) {
        return "busy";
      }
      return "cap-reached";
    },

    async release(
      team: TeamId,
      day: string,
      jobId: string,
      refund: boolean,
    ): Promise<void> {
      // Owner-checked (`lease_job_id = ?`): a stale/redelivered job whose
      // lease was already taken over by a newer job is a no-op here, never
      // clearing the newer job's lease.
      await db
        .prepare(
          `UPDATE hackathon_analysis_usage
            SET lease_until = 0, lease_job_id = NULL, runs = runs - ?
            WHERE team_id = ? AND utc_day = ? AND lease_job_id = ?`,
        )
        .bind(refund ? 1 : 0, team, day, jobId)
        .run();
    },
  };
}
