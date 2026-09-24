import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createD1RepoTopicLinkRepo } from "../../../src/adapters/d1/repo-topic-link-repo";
import { TenantMismatchError } from "../../../src/domain/errors";
import { parseRepoFullName } from "../../../src/domain/github";
import { asTeamId } from "../../../src/domain/ids";

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

// RES-001: proves a D1 failure propagates (rejects) rather than being
// swallowed — mirrors the same stub used in github-org-claim-repo.test.ts.
// None of these adapter methods has a try/catch, so this pins down that an
// unavailable D1 rejects the caller rather than being silently absorbed.
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

function repoFullName(raw: string) {
  const parsed = parseRepoFullName(raw);
  if (!parsed) throw new Error(`invalid test fixture repo: ${raw}`);
  return parsed;
}

describe("createD1RepoTopicLinkRepo", () => {
  it("get returns null when no link exists for the repo", async () => {
    const repo = createD1RepoTopicLinkRepo(env.DB);

    const result = await repo.get(asTeamId("team-nolink"), repoFullName("acme/none"));

    expect(result).toBeNull();
  });

  it("get returns the link when one exists for the team and repo", async () => {
    await seedTeam("team-get-1", 801);
    await seedClaim("get-org", "team-get-1");
    await env.DB.prepare(
      "INSERT INTO repo_topic_links (team_id, repo_full_name, org_login, thread_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind("team-get-1", "get-org/repo", "get-org", 55, 10, 20)
      .run();
    const repo = createD1RepoTopicLinkRepo(env.DB);

    const result = await repo.get(asTeamId("team-get-1"), repoFullName("get-org/repo"));

    expect(result).toEqual({
      teamId: asTeamId("team-get-1"),
      repoFullName: repoFullName("get-org/repo"),
      orgLogin: "get-org",
      threadId: 55,
      createdAt: 10,
      updatedAt: 20,
    });
  });

  it("get is tenant-scoped: a link with the same repo path under a different team is not returned (RES-002/tenant isolation)", async () => {
    await seedTeam("team-get-owner", 802);
    await seedTeam("team-get-other", 803);
    await seedClaim("shared-get-org", "team-get-owner");
    await env.DB.prepare(
      "INSERT INTO repo_topic_links (team_id, repo_full_name, org_login, thread_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind("team-get-owner", "shared-get-org/repo", "shared-get-org", 1, 0, 0)
      .run();
    const repo = createD1RepoTopicLinkRepo(env.DB);

    const result = await repo.get(
      asTeamId("team-get-other"),
      repoFullName("shared-get-org/repo"),
    );

    expect(result).toBeNull();
  });

  it("upsert inserts a new link when none exists for the (team, repo)", async () => {
    await seedTeam("team-upsert-1", 810);
    await seedClaim("upsert-org", "team-upsert-1");
    const repo = createD1RepoTopicLinkRepo(env.DB);
    const link = {
      teamId: asTeamId("team-upsert-1"),
      repoFullName: repoFullName("upsert-org/repo"),
      orgLogin: "upsert-org",
      threadId: 111,
      createdAt: 1000,
      updatedAt: 1000,
    };

    await repo.upsert(asTeamId("team-upsert-1"), link);

    const stored = await repo.get(
      asTeamId("team-upsert-1"),
      repoFullName("upsert-org/repo"),
    );
    expect(stored).toEqual(link);
  });

  it("upsert moves an already-linked repo to a new thread instead of erroring on the PK conflict (re-link semantics)", async () => {
    await seedTeam("team-upsert-2", 811);
    await seedClaim("upsert-org-2", "team-upsert-2");
    const repo = createD1RepoTopicLinkRepo(env.DB);
    await repo.upsert(asTeamId("team-upsert-2"), {
      teamId: asTeamId("team-upsert-2"),
      repoFullName: repoFullName("upsert-org-2/repo"),
      orgLogin: "upsert-org-2",
      threadId: 200,
      createdAt: 1000,
      updatedAt: 1000,
    });

    await repo.upsert(asTeamId("team-upsert-2"), {
      teamId: asTeamId("team-upsert-2"),
      repoFullName: repoFullName("upsert-org-2/repo"),
      orgLogin: "upsert-org-2",
      threadId: 300,
      createdAt: 1000,
      updatedAt: 2000,
    });

    const moved = await repo.get(
      asTeamId("team-upsert-2"),
      repoFullName("upsert-org-2/repo"),
    );
    expect(moved).toEqual({
      teamId: asTeamId("team-upsert-2"),
      repoFullName: repoFullName("upsert-org-2/repo"),
      orgLogin: "upsert-org-2",
      threadId: 300,
      createdAt: 1000,
      updatedAt: 2000,
    });
  });

  it("upsert rejects (and writes nothing) when the teamId argument disagrees with link.teamId (RISK-001/REL-002/READ-001: teamId argument must be authoritative)", async () => {
    await seedTeam("team-mismatch-a", 812);
    await seedTeam("team-mismatch-b", 813);
    await seedClaim("mismatch-org", "team-mismatch-b");
    const repo = createD1RepoTopicLinkRepo(env.DB);

    await expect(
      repo.upsert(asTeamId("team-mismatch-a"), {
        teamId: asTeamId("team-mismatch-b"),
        repoFullName: repoFullName("mismatch-org/repo"),
        orgLogin: "mismatch-org",
        threadId: 500,
        createdAt: 0,
        updatedAt: 0,
      }),
    ).rejects.toThrow(TenantMismatchError);

    const underArgumentTeam = await repo.get(
      asTeamId("team-mismatch-a"),
      repoFullName("mismatch-org/repo"),
    );
    const underLinkTeam = await repo.get(
      asTeamId("team-mismatch-b"),
      repoFullName("mismatch-org/repo"),
    );
    expect(underArgumentTeam).toBeNull();
    expect(underLinkTeam).toBeNull();
  });

  it("remove deletes the link and returns true when it existed", async () => {
    await seedTeam("team-remove-1", 820);
    await seedClaim("remove-org", "team-remove-1");
    const repo = createD1RepoTopicLinkRepo(env.DB);
    await repo.upsert(asTeamId("team-remove-1"), {
      teamId: asTeamId("team-remove-1"),
      repoFullName: repoFullName("remove-org/repo"),
      orgLogin: "remove-org",
      threadId: 400,
      createdAt: 0,
      updatedAt: 0,
    });

    const removed = await repo.remove(
      asTeamId("team-remove-1"),
      repoFullName("remove-org/repo"),
    );

    expect(removed).toBe(true);
    const stored = await repo.get(
      asTeamId("team-remove-1"),
      repoFullName("remove-org/repo"),
    );
    expect(stored).toBeNull();
  });

  it("remove is tenant-scoped: remove(teamB, repo) does not delete teamA's link for the same repo path (REL-003)", async () => {
    await seedTeam("team-remove-owner", 822);
    await seedTeam("team-remove-other", 823);
    await seedClaim("remove-iso-org", "team-remove-owner");
    const repo = createD1RepoTopicLinkRepo(env.DB);
    await repo.upsert(asTeamId("team-remove-owner"), {
      teamId: asTeamId("team-remove-owner"),
      repoFullName: repoFullName("remove-iso-org/repo"),
      orgLogin: "remove-iso-org",
      threadId: 600,
      createdAt: 0,
      updatedAt: 0,
    });

    const removed = await repo.remove(
      asTeamId("team-remove-other"),
      repoFullName("remove-iso-org/repo"),
    );

    expect(removed).toBe(false);
    const stillThere = await repo.get(
      asTeamId("team-remove-owner"),
      repoFullName("remove-iso-org/repo"),
    );
    expect(stillThere).not.toBeNull();
    expect(stillThere?.threadId).toBe(600);
  });

  it("remove returns false when no link exists for the (team, repo) (idempotent)", async () => {
    await seedTeam("team-remove-2", 821);
    const repo = createD1RepoTopicLinkRepo(env.DB);

    const removed = await repo.remove(
      asTeamId("team-remove-2"),
      repoFullName("remove-org-2/never-linked"),
    );

    expect(removed).toBe(false);
  });

  it("list returns an empty array when the team has no links", async () => {
    await seedTeam("team-list-empty", 830);
    const repo = createD1RepoTopicLinkRepo(env.DB);

    const result = await repo.list(asTeamId("team-list-empty"));

    expect(result).toEqual([]);
  });

  it("list returns all links for the team", async () => {
    await seedTeam("team-list-1", 831);
    await seedClaim("list-org-a", "team-list-1");
    await seedClaim("list-org-b", "team-list-1");
    const repo = createD1RepoTopicLinkRepo(env.DB);
    await repo.upsert(asTeamId("team-list-1"), {
      teamId: asTeamId("team-list-1"),
      repoFullName: repoFullName("list-org-a/one"),
      orgLogin: "list-org-a",
      threadId: 1,
      createdAt: 0,
      updatedAt: 0,
    });
    await repo.upsert(asTeamId("team-list-1"), {
      teamId: asTeamId("team-list-1"),
      repoFullName: repoFullName("list-org-b/two"),
      orgLogin: "list-org-b",
      threadId: 2,
      createdAt: 0,
      updatedAt: 0,
    });

    const result = await repo.list(asTeamId("team-list-1"));

    expect(result.map((l) => l.repoFullName).sort()).toEqual([
      "list-org-a/one",
      "list-org-b/two",
    ]);
  });

  it("list is tenant-scoped: it never returns another team's links (cross-team isolation)", async () => {
    await seedTeam("team-list-owner", 832);
    await seedTeam("team-list-other", 833);
    await seedClaim("list-iso-org", "team-list-owner");
    const repo = createD1RepoTopicLinkRepo(env.DB);
    await repo.upsert(asTeamId("team-list-owner"), {
      teamId: asTeamId("team-list-owner"),
      repoFullName: repoFullName("list-iso-org/repo"),
      orgLogin: "list-iso-org",
      threadId: 9,
      createdAt: 0,
      updatedAt: 0,
    });

    const result = await repo.list(asTeamId("team-list-other"));

    expect(result).toEqual([]);
  });

  it("get propagates (rejects) when the D1 query fails, instead of swallowing the error (RES-001)", async () => {
    const repo = createD1RepoTopicLinkRepo(failingDb());

    await expect(
      repo.get(asTeamId("any-team"), repoFullName("any-org/any-repo")),
    ).rejects.toThrow("D1_ERROR: simulated D1 outage");
  });
});
