import type { TeamId } from "../../domain/ids";
import type { NlClassifyQuota } from "../../domain/ports";

interface QuotaRow {
  count: number;
}

// Soft per-team daily classify counter (design.md decision 8). Separate from
// hackathon analysis quota. Returns false when the cap would be exceeded.
export function createD1NlClassifyQuota(db: D1Database): NlClassifyQuota {
  return {
    async reserve(teamId: TeamId, dayUtc: string, cap: number): Promise<boolean> {
      const stmt = db
        .prepare(
          `INSERT INTO nl_classify_quota (team_id, day_utc, count)
           VALUES (?, ?, 1)
           ON CONFLICT (team_id, day_utc) DO UPDATE SET
             count = count + 1
           WHERE count < ?`,
        )
        .bind(teamId, dayUtc, cap);

      const result = await stmt.run();
      if ((result.meta.changes ?? 0) === 1) {
        return true;
      }

      // Cap already reached (or conflict with no update). Confirm via read.
      const row = await db
        .prepare(
          "SELECT count FROM nl_classify_quota WHERE team_id = ? AND day_utc = ?",
        )
        .bind(teamId, dayUtc)
        .first<QuotaRow>();
      return row !== null && row.count < cap;
    },
  };
}
