import { asTeamId } from "../../domain/ids";
import type { TeamId } from "../../domain/ids";
import type { GithubOrgClaimRepo } from "../../domain/ports";

interface ClaimRow {
  team_id: string;
}

export function createD1GithubOrgClaimRepo(db: D1Database): GithubOrgClaimRepo {
  return {
    async findTeamByOrg(orgLogin: string): Promise<TeamId | null> {
      // Claims are stored lowercase (CHECK constraint, migrations/0002).
      // GitHub sends the org's display case in webhook payloads, so the
      // lookup normalizes the input to match.
      const row = await db
        .prepare("SELECT team_id FROM github_org_claims WHERE org_login = ?")
        .bind(orgLogin.toLowerCase())
        .first<ClaimRow>();
      return row ? asTeamId(row.team_id) : null;
    },

    async isClaimedBy(teamId: TeamId, orgLogin: string): Promise<boolean> {
      const row = await db
        .prepare(
          "SELECT 1 FROM github_org_claims WHERE team_id = ? AND org_login = ?",
        )
        .bind(teamId, orgLogin.toLowerCase())
        .first();
      return row !== null;
    },
  };
}
