import type { RepoTopicLink } from "../../domain/entities";
import { TenantMismatchError } from "../../domain/errors";
import type { RepoFullName } from "../../domain/github";
import { asTeamId } from "../../domain/ids";
import type { TeamId } from "../../domain/ids";
import type { RepoTopicLinkRepo } from "../../domain/ports";

interface LinkRow {
  team_id: string;
  repo_full_name: string;
  org_login: string;
  thread_id: number;
  created_at: number;
  updated_at: number;
}

function rowToLink(row: LinkRow): RepoTopicLink {
  return {
    teamId: asTeamId(row.team_id),
    repoFullName: row.repo_full_name as RepoFullName,
    orgLogin: row.org_login,
    threadId: row.thread_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createD1RepoTopicLinkRepo(db: D1Database): RepoTopicLinkRepo {
  return {
    async get(teamId: TeamId, repo: RepoFullName): Promise<RepoTopicLink | null> {
      const row = await db
        .prepare(
          "SELECT * FROM repo_topic_links WHERE team_id = ? AND repo_full_name = ?",
        )
        .bind(teamId, repo)
        .first<LinkRow>();
      return row ? rowToLink(row) : null;
    },

    async upsert(teamId: TeamId, link: RepoTopicLink): Promise<void> {
      // The explicit `teamId` argument is authoritative (ports.ts "Tenancy":
      // every tenant-scoped method takes TeamId first) — a caller passing a
      // `link.teamId` that disagrees with it is a bug, and MUST NOT silently
      // write under the mismatched team (RISK-001/REL-002/READ-001).
      if (teamId !== link.teamId) {
        throw new TenantMismatchError(
          `RepoTopicLinkRepo.upsert: teamId argument ("${teamId}") does not match link.teamId ("${link.teamId}")`,
        );
      }

      // Re-linking an already-linked repo moves it instead of erroring on
      // the (team_id, repo_full_name) PK conflict (design.md "One Topic Per
      // Repo, Re-Link Moves It" — ports.ts RepoTopicLinkRepo.upsert).
      await db
        .prepare(
          `INSERT INTO repo_topic_links
            (team_id, repo_full_name, org_login, thread_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (team_id, repo_full_name)
           DO UPDATE SET thread_id = excluded.thread_id, updated_at = excluded.updated_at`,
        )
        .bind(
          teamId,
          link.repoFullName,
          link.orgLogin,
          link.threadId,
          link.createdAt,
          link.updatedAt,
        )
        .run();
    },

    async remove(teamId: TeamId, repo: RepoFullName): Promise<boolean> {
      const result = await db
        .prepare(
          "DELETE FROM repo_topic_links WHERE team_id = ? AND repo_full_name = ?",
        )
        .bind(teamId, repo)
        .run();
      return result.meta.changes === 1;
    },

    async list(teamId: TeamId): Promise<RepoTopicLink[]> {
      const rows = await db
        .prepare("SELECT * FROM repo_topic_links WHERE team_id = ?")
        .bind(teamId)
        .all<LinkRow>();
      return rows.results.map(rowToLink);
    },
  };
}
