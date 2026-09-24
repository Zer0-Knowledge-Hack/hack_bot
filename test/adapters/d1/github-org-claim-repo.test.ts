import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createD1GithubOrgClaimRepo } from "../../../src/adapters/d1/github-org-claim-repo";
import { asTeamId } from "../../../src/domain/ids";

// RES-001: proves a D1 failure propagates (rejects) rather than being
// swallowed. No adapter method here has a try/catch, so this is really
// characterizing "await on a rejecting D1 call rejects the caller" — but it
// is worth pinning down explicitly, since a future refactor adding
// try/catch (e.g. for constraint-error translation, as team-repo.ts does)
// could accidentally swallow this. The stub only implements `prepare`,
// which is all these two methods call.
function failingDb(message = "D1_ERROR: simulated D1 outage"): D1Database {
  const err = new Error(message);
  const statement = {
    bind: () => statement,
    first: async () => {
      throw err;
    },
    run: async () => {
      throw err;
    },
    all: async () => {
      throw err;
    },
  };
  return { prepare: () => statement } as unknown as D1Database;
}

async function seedTeam(teamId: string, chatId: number) {
  await env.DB.prepare(
    "INSERT INTO teams (id, telegram_chat_id, created_at) VALUES (?, ?, ?)",
  )
    .bind(teamId, chatId, 0)
    .run();
}

async function seedClaim(orgLogin: string, teamId: string) {
  await env.DB.prepare(
    "INSERT INTO github_org_claims (org_login, team_id, created_at) VALUES (?, ?, ?)",
  )
    .bind(orgLogin, teamId, 0)
    .run();
}

describe("createD1GithubOrgClaimRepo", () => {
  it("findTeamByOrg returns null when no claim exists for the org", async () => {
    const repo = createD1GithubOrgClaimRepo(env.DB);

    const result = await repo.findTeamByOrg("no-such-org");

    expect(result).toBeNull();
  });

  it("findTeamByOrg returns the claiming team's id when a claim exists", async () => {
    await seedTeam("team-org-1", 701);
    await seedClaim("acme-corp", "team-org-1");
    const repo = createD1GithubOrgClaimRepo(env.DB);

    const result = await repo.findTeamByOrg("acme-corp");

    expect(result).toBe(asTeamId("team-org-1"));
  });

  it("findTeamByOrg matches regardless of the input's case (claims are stored lowercase, GitHub sends the org's display case)", async () => {
    await seedTeam("team-org-2", 702);
    await seedClaim("mixed-org", "team-org-2");
    const repo = createD1GithubOrgClaimRepo(env.DB);

    const result = await repo.findTeamByOrg("Mixed-Org");

    expect(result).toBe(asTeamId("team-org-2"));
  });

  it("isClaimedBy returns true when the team has a claim for the org", async () => {
    await seedTeam("team-claimed-1", 703);
    await seedClaim("claimed-org-1", "team-claimed-1");
    const repo = createD1GithubOrgClaimRepo(env.DB);

    const result = await repo.isClaimedBy(
      asTeamId("team-claimed-1"),
      "claimed-org-1",
    );

    expect(result).toBe(true);
  });

  it("isClaimedBy returns false for a team that did not claim the org, even when another team did (tenant isolation)", async () => {
    await seedTeam("team-claimed-owner", 704);
    await seedTeam("team-claimed-other", 705);
    await seedClaim("claimed-org-2", "team-claimed-owner");
    const repo = createD1GithubOrgClaimRepo(env.DB);

    const result = await repo.isClaimedBy(
      asTeamId("team-claimed-other"),
      "claimed-org-2",
    );

    expect(result).toBe(false);
  });

  it("isClaimedBy matches regardless of the input's case, exactly like findTeamByOrg (REL-001)", async () => {
    await seedTeam("team-claimed-case", 707);
    await seedClaim("case-org", "team-claimed-case");
    const repo = createD1GithubOrgClaimRepo(env.DB);

    const result = await repo.isClaimedBy(
      asTeamId("team-claimed-case"),
      "Case-Org",
    );

    expect(result).toBe(true);
  });

  it("isClaimedBy returns false when no claim exists at all", async () => {
    await seedTeam("team-claimed-none", 706);
    const repo = createD1GithubOrgClaimRepo(env.DB);

    const result = await repo.isClaimedBy(
      asTeamId("team-claimed-none"),
      "never-claimed-org",
    );

    expect(result).toBe(false);
  });

  it("findTeamByOrg propagates (rejects) when the D1 query fails, instead of swallowing the error (RES-001)", async () => {
    const repo = createD1GithubOrgClaimRepo(failingDb());

    await expect(repo.findTeamByOrg("any-org")).rejects.toThrow(
      "D1_ERROR: simulated D1 outage",
    );
  });
});
