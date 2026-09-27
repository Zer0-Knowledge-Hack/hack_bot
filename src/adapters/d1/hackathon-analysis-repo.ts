import type { HackathonAnalysis } from "../../domain/entities";
import type { ExtractedFields } from "../../domain/hackathon/extraction";
import type { RepoFullName } from "../../domain/github";
import { asTeamId } from "../../domain/ids";
import type { TeamId } from "../../domain/ids";
import type { HackathonAnalysisRepo } from "../../domain/ports";

interface AnalysisRow {
  id: string;
  team_id: string;
  slug: string;
  source_url: string;
  normalized_url: string;
  fields: string;
  suggested_repos: string;
  thread_id: number | null;
  pinned_message_id: number | null;
  created_at: number;
  updated_at: number;
}

function rowToAnalysis(row: AnalysisRow): HackathonAnalysis {
  return {
    id: row.id,
    teamId: asTeamId(row.team_id),
    slug: row.slug,
    sourceUrl: row.source_url,
    normalizedUrl: row.normalized_url,
    fields: JSON.parse(row.fields) as ExtractedFields,
    suggestedRepos: JSON.parse(row.suggested_repos) as RepoFullName[],
    threadId: row.thread_id,
    pinnedMessageId: row.pinned_message_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createD1HackathonAnalysisRepo(db: D1Database): HackathonAnalysisRepo {
  return {
    async findBySlug(teamId: TeamId, slug: string): Promise<HackathonAnalysis | null> {
      const row = await db
        .prepare("SELECT * FROM hackathon_analyses WHERE team_id = ? AND slug = ?")
        .bind(teamId, slug)
        .first<AnalysisRow>();
      return row ? rowToAnalysis(row) : null;
    },

    async findById(teamId: TeamId, id: string): Promise<HackathonAnalysis | null> {
      const row = await db
        .prepare("SELECT * FROM hackathon_analyses WHERE team_id = ? AND id = ?")
        .bind(teamId, id)
        .first<AnalysisRow>();
      return row ? rowToAnalysis(row) : null;
    },

    async findByNormalizedUrl(
      teamId: TeamId,
      normalizedUrl: string,
    ): Promise<HackathonAnalysis | null> {
      const row = await db
        .prepare(
          "SELECT * FROM hackathon_analyses WHERE team_id = ? AND normalized_url = ?",
        )
        .bind(teamId, normalizedUrl)
        .first<AnalysisRow>();
      return row ? rowToAnalysis(row) : null;
    },

    async findByThreadId(
      teamId: TeamId,
      threadId: number,
    ): Promise<HackathonAnalysis | null> {
      const row = await db
        .prepare("SELECT * FROM hackathon_analyses WHERE team_id = ? AND thread_id = ?")
        .bind(teamId, threadId)
        .first<AnalysisRow>();
      return row ? rowToAnalysis(row) : null;
    },

    async slugExists(teamId: TeamId, slug: string): Promise<boolean> {
      const row = await db
        .prepare("SELECT 1 FROM hackathon_analyses WHERE team_id = ? AND slug = ?")
        .bind(teamId, slug)
        .first();
      return row !== null;
    },

    // Insert-or-update by id (design.md "Same-URL Refresh Keeps the Slug").
    async save(analysis: HackathonAnalysis): Promise<void> {
      await db
        .prepare(
          `INSERT INTO hackathon_analyses
            (id, team_id, slug, source_url, normalized_url, fields, suggested_repos,
             thread_id, pinned_message_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        )
        .run();
    },

    async listByTeam(teamId: TeamId): Promise<HackathonAnalysis[]> {
      const rows = await db
        .prepare("SELECT * FROM hackathon_analyses WHERE team_id = ?")
        .bind(teamId)
        .all<AnalysisRow>();
      return rows.results.map(rowToAnalysis);
    },

    // task 5.3a: one atomic `db.batch` — clear the displaced analysis's link
    // FIRST (statements run in array order, design.md/audit.ts convention),
    // then set the new one. Doing this as two separate calls (the old
    // `postAnalysisAndLinkTopic`) risked a crash between them leaving a
    // topic un-linked or double-linked (RELI-002/RESI-003); running the
    // clear before the set also avoids a transient UNIQUE-index violation on
    // (team_id, thread_id) within the same transaction.
    async moveTopicLink(
      teamId: TeamId,
      analysisId: string,
      threadId: number,
      pinnedMessageId: number | null,
    ): Promise<void> {
      await db.batch([
        db
          .prepare(
            `UPDATE hackathon_analyses
              SET thread_id = NULL, pinned_message_id = NULL
              WHERE team_id = ? AND thread_id = ? AND id != ?`,
          )
          .bind(teamId, threadId, analysisId),
        db
          .prepare(
            `UPDATE hackathon_analyses
              SET thread_id = ?, pinned_message_id = ?
              WHERE team_id = ? AND id = ?`,
          )
          .bind(threadId, pinnedMessageId, teamId, analysisId),
      ]);
    },
  };
}
