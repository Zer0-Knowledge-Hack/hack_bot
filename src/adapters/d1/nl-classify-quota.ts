import type { TeamId } from "../../domain/ids";
import type { NlClassifyQuota } from "../../domain/ports";

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
      // Fail closed: only a successful reservation (exactly one row change)
      // grants a classify slot. Never infer allowance from a follow-up read —
      // that path could fail-open when the UPDATE did not apply.
      return (result.meta.changes ?? 0) === 1;
    },
  };
}
