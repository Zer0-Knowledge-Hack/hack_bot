import type { FeedbackNote, FeedbackSource, FeedbackStatus } from "../../domain/entities";
import { asMembershipId, asTeamId } from "../../domain/ids";
import type { TeamId } from "../../domain/ids";
import type { FeedbackFilter, FeedbackRepo } from "../../domain/ports";

interface FeedbackRow {
  id: string;
  team_id: string;
  author_membership_id: string;
  repo_hint: string | null;
  raw_text: string;
  source_type: string;
  status: string;
  created_at: number;
  updated_at: number;
}

function rowToNote(row: FeedbackRow): FeedbackNote {
  return {
    id: row.id,
    teamId: asTeamId(row.team_id),
    authorMembershipId: asMembershipId(row.author_membership_id),
    repoHint: row.repo_hint,
    rawText: row.raw_text,
    sourceType: row.source_type as FeedbackSource,
    status: row.status as FeedbackStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createD1FeedbackRepo(db: D1Database): FeedbackRepo {
  return {
    async save(teamId: TeamId, note: FeedbackNote): Promise<void> {
      await db
        .prepare(
          `INSERT INTO feedback_notes (
            id, team_id, author_membership_id, repo_hint, raw_text, source_type, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            repo_hint = excluded.repo_hint,
            raw_text = excluded.raw_text,
            status = excluded.status,
            updated_at = excluded.updated_at`,
        )
        .bind(
          note.id,
          teamId,
          note.authorMembershipId,
          note.repoHint,
          note.rawText,
          note.sourceType,
          note.status,
          note.createdAt,
          note.updatedAt,
        )
        .run();
    },

    async list(teamId: TeamId, filter: FeedbackFilter = {}): Promise<FeedbackNote[]> {
      let query = "SELECT * FROM feedback_notes WHERE team_id = ?";
      const params: unknown[] = [teamId];

      if (filter.status) {
        query += " AND status = ?";
        params.push(filter.status);
      }

      if (filter.repoHint) {
        query += " AND repo_hint = ?";
        params.push(filter.repoHint);
      }

      if (filter.since !== undefined) {
        query += " AND created_at >= ?";
        params.push(filter.since);
      }

      query += " ORDER BY created_at ASC";

      if (filter.limit !== undefined && filter.limit > 0) {
        query += " LIMIT ?";
        params.push(filter.limit);
      }

      const rows = await db.prepare(query).bind(...params).all<FeedbackRow>();
      return (rows.results || []).map(rowToNote);
    },

    async updateStatus(
      teamId: TeamId,
      noteIds: string[],
      status: FeedbackStatus,
    ): Promise<void> {
      if (noteIds.length === 0) return;
      const now = Date.now();
      const stmts = noteIds.map((id) =>
        db
          .prepare(
            "UPDATE feedback_notes SET status = ?, updated_at = ? WHERE team_id = ? AND id = ?",
          )
          .bind(status, now, teamId, id),
      );
      await db.batch(stmts);
    },
  };
}
