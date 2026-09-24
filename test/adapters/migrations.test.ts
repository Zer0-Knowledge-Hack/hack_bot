import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

// Verifies migrations/0001_init.sql (design.md schema) is applied by the
// global setup file (test/setup/apply-migrations.ts) before this file runs,
// and that the declared constraints (FKs, UNIQUE, CHECK) actually hold.

describe("migrations/0001_init.sql", () => {
  it("creates every table declared in the design schema", async () => {
    const rows = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'd1_%' AND name NOT LIKE '_cf_%' ORDER BY name",
    ).all<{ name: string }>();

    const names = rows.results.map((r) => r.name);
    expect(names).toEqual([
      "audit_log",
      "dm_selections",
      // github_org_claims and repo_topic_links: migrations/0002_github_alerts.sql
      // (PR2 covers their own FK/UNIQUE/CHECK migration tests).
      "github_org_claims",
      "members",
      "memberships",
      "profile_fields",
      "repo_topic_links",
      "teams",
    ]);
  });

  it("rejects a membership row whose team_id has no matching team (FK enforced)", async () => {
    await expect(
      env.DB.prepare(
        "INSERT INTO memberships (id, team_id, member_id, role, joined_at) VALUES (?, ?, ?, ?, ?)",
      )
        .bind("m-orphan", "missing-team", "missing-member", "member", 0)
        .run(),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/i);
  });

  it("rejects a second team bound to the same telegram_chat_id (UNIQUE enforced)", async () => {
    await env.DB.prepare(
      "INSERT INTO teams (id, telegram_chat_id, created_at) VALUES (?, ?, ?)",
    )
      .bind("team-dup-1", 555, 0)
      .run();

    await expect(
      env.DB.prepare(
        "INSERT INTO teams (id, telegram_chat_id, created_at) VALUES (?, ?, ?)",
      )
        .bind("team-dup-2", 555, 0)
        .run(),
    ).rejects.toThrow(/UNIQUE constraint failed/i);
  });

  it("rejects a membership role outside the CHECK constraint", async () => {
    await env.DB.prepare(
      "INSERT INTO teams (id, telegram_chat_id, created_at) VALUES (?, ?, ?)",
    )
      .bind("team-check", 556, 0)
      .run();
    await env.DB.prepare(
      "INSERT INTO members (id, telegram_user_id, created_at) VALUES (?, ?, ?)",
    )
      .bind("member-check", 900, 0)
      .run();

    await expect(
      env.DB.prepare(
        "INSERT INTO memberships (id, team_id, member_id, role, joined_at) VALUES (?, ?, ?, ?, ?)",
      )
        .bind("m-bad-role", "team-check", "member-check", "owner", 0)
        .run(),
    ).rejects.toThrow(/CHECK constraint failed/i);
  });

  it("rejects a profile_fields row whose (team_id, membership_id) has no matching membership (composite FK enforced)", async () => {
    await expect(
      env.DB.prepare(
        "INSERT INTO profile_fields (team_id, membership_id, field, value, key_version, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
        .bind("missing-team", "missing-membership", "full_name", new Uint8Array([1]).buffer, 1, 0)
        .run(),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/i);
  });

  it("rejects a profile_fields row whose field is outside the CHECK constraint", async () => {
    await env.DB.prepare(
      "INSERT INTO teams (id, telegram_chat_id, created_at) VALUES (?, ?, ?)",
    )
      .bind("team-pf-check", 557, 0)
      .run();
    await env.DB.prepare(
      "INSERT INTO members (id, telegram_user_id, created_at) VALUES (?, ?, ?)",
    )
      .bind("member-pf-check", 901, 0)
      .run();
    await env.DB.prepare(
      "INSERT INTO memberships (id, team_id, member_id, role, joined_at) VALUES (?, ?, ?, 'member', ?)",
    )
      .bind("m-pf-check", "team-pf-check", "member-pf-check", 0)
      .run();

    await expect(
      env.DB.prepare(
        "INSERT INTO profile_fields (team_id, membership_id, field, value, key_version, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
        .bind("team-pf-check", "m-pf-check", "phone_number", new Uint8Array([1]).buffer, null, 0)
        .run(),
    ).rejects.toThrow(/CHECK constraint failed/i);
  });

  it("rejects an audit_log row whose (team_id, actor_membership_id) has no matching membership (composite FK enforced)", async () => {
    await env.DB.prepare(
      "INSERT INTO teams (id, telegram_chat_id, created_at) VALUES (?, ?, ?)",
    )
      .bind("team-audit-fk", 558, 0)
      .run();
    await env.DB.prepare(
      "INSERT INTO members (id, telegram_user_id, created_at) VALUES (?, ?, ?)",
    )
      .bind("member-audit-fk", 902, 0)
      .run();
    await env.DB.prepare(
      "INSERT INTO memberships (id, team_id, member_id, role, joined_at) VALUES (?, ?, ?, 'member', ?)",
    )
      .bind("m-audit-fk", "team-audit-fk", "member-audit-fk", 0)
      .run();

    await expect(
      env.DB.prepare(
        "INSERT INTO audit_log (id, team_id, actor_membership_id, target_membership_id, field, old_value, new_value, key_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
        .bind(
          "audit-orphan",
          "team-audit-fk",
          "missing-actor-membership",
          "m-audit-fk",
          "role",
          null,
          "admin",
          null,
          0,
        )
        .run(),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/i);
  });

  it("rejects a dm_selections row whose team_id has no matching team (FK enforced)", async () => {
    await expect(
      env.DB.prepare(
        "INSERT INTO dm_selections (telegram_user_id, team_id, expires_at) VALUES (?, ?, ?)",
      )
        .bind(999, "missing-team-for-dm", 0)
        .run(),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/i);
  });
});

// migrations/0002_github_alerts.sql (design.md "Data Flow" SQL block).
// PR2 (Phase 2 tasks.md 2.1) — raw SQL-level constraint verification against
// the migration shipped in PR1. These tests exercise `env.DB` directly, not
// the adapters (src/adapters/d1/{github-org-claim-repo,repo-topic-link-repo}.ts
// — see repo-scoped tests for that layer).
describe("migrations/0002_github_alerts.sql", () => {
  it("rejects a github_org_claims row whose org_login is not already lowercase (CHECK enforced)", async () => {
    await env.DB.prepare(
      "INSERT INTO teams (id, telegram_chat_id, created_at) VALUES (?, ?, ?)",
    )
      .bind("team-claim-check", 601, 0)
      .run();

    await expect(
      env.DB.prepare(
        "INSERT INTO github_org_claims (org_login, team_id, created_at) VALUES (?, ?, ?)",
      )
        .bind("Octocat", "team-claim-check", 0)
        .run(),
    ).rejects.toThrow(/CHECK constraint failed/i);
  });

  it("rejects a github_org_claims row whose team_id has no matching team (FK enforced)", async () => {
    await expect(
      env.DB.prepare(
        "INSERT INTO github_org_claims (org_login, team_id, created_at) VALUES (?, ?, ?)",
      )
        .bind("orphan-org", "missing-team-for-claim", 0)
        .run(),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/i);
  });

  it("rejects a second claim for an already-claimed org, even by a different team (one org -> one team, PK enforced)", async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO teams (id, telegram_chat_id, created_at) VALUES (?, ?, ?)",
      ).bind("team-claim-a", 602, 0),
      env.DB.prepare(
        "INSERT INTO teams (id, telegram_chat_id, created_at) VALUES (?, ?, ?)",
      ).bind("team-claim-b", 603, 0),
      env.DB.prepare(
        "INSERT INTO github_org_claims (org_login, team_id, created_at) VALUES (?, ?, ?)",
      ).bind("shared-org", "team-claim-a", 0),
    ]);

    await expect(
      env.DB.prepare(
        "INSERT INTO github_org_claims (org_login, team_id, created_at) VALUES (?, ?, ?)",
      )
        .bind("shared-org", "team-claim-b", 0)
        .run(),
    ).rejects.toThrow(/UNIQUE constraint failed/i);
  });

  it("rejects a repo_topic_links row whose repo_full_name is not already lowercase (CHECK enforced)", async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO teams (id, telegram_chat_id, created_at) VALUES (?, ?, ?)",
      ).bind("team-link-check", 604, 0),
      env.DB.prepare(
        "INSERT INTO github_org_claims (org_login, team_id, created_at) VALUES (?, ?, ?)",
      ).bind("link-check-org", "team-link-check", 0),
    ]);

    await expect(
      env.DB.prepare(
        "INSERT INTO repo_topic_links (team_id, repo_full_name, org_login, thread_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
        .bind("team-link-check", "link-check-org/Repo", "link-check-org", 1, 0, 0)
        .run(),
    ).rejects.toThrow(/CHECK constraint failed/i);
  });

  it("rejects a repo_topic_links row whose (team_id, org_login) has no matching claim (composite FK enforced)", async () => {
    await env.DB.prepare(
      "INSERT INTO teams (id, telegram_chat_id, created_at) VALUES (?, ?, ?)",
    )
      .bind("team-link-fk", 605, 0)
      .run();

    await expect(
      env.DB.prepare(
        "INSERT INTO repo_topic_links (team_id, repo_full_name, org_login, thread_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
        .bind("team-link-fk", "unclaimed-org/repo", "unclaimed-org", 1, 0, 0)
        .run(),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/i);
  });

  it("rejects a second row for the same (team_id, repo_full_name) (one topic per repo per team, PK enforced)", async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO teams (id, telegram_chat_id, created_at) VALUES (?, ?, ?)",
      ).bind("team-link-dup", 606, 0),
      env.DB.prepare(
        "INSERT INTO github_org_claims (org_login, team_id, created_at) VALUES (?, ?, ?)",
      ).bind("dup-org", "team-link-dup", 0),
      env.DB.prepare(
        "INSERT INTO repo_topic_links (team_id, repo_full_name, org_login, thread_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).bind("team-link-dup", "dup-org/repo", "dup-org", 10, 0, 0),
    ]);

    await expect(
      env.DB.prepare(
        "INSERT INTO repo_topic_links (team_id, repo_full_name, org_login, thread_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
        .bind("team-link-dup", "dup-org/repo", "dup-org", 20, 0, 0)
        .run(),
    ).rejects.toThrow(/UNIQUE constraint failed/i);
  });

  it("isolates repo_topic_links reads by team_id: a query for team A never returns team B's links, even for a same-shaped repo path", async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO teams (id, telegram_chat_id, created_at) VALUES (?, ?, ?)",
      ).bind("team-iso-a", 607, 0),
      env.DB.prepare(
        "INSERT INTO teams (id, telegram_chat_id, created_at) VALUES (?, ?, ?)",
      ).bind("team-iso-b", 608, 0),
      env.DB.prepare(
        "INSERT INTO github_org_claims (org_login, team_id, created_at) VALUES (?, ?, ?)",
      ).bind("iso-org-a", "team-iso-a", 0),
      env.DB.prepare(
        "INSERT INTO github_org_claims (org_login, team_id, created_at) VALUES (?, ?, ?)",
      ).bind("iso-org-b", "team-iso-b", 0),
      env.DB.prepare(
        "INSERT INTO repo_topic_links (team_id, repo_full_name, org_login, thread_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).bind("team-iso-a", "iso-org-a/repo", "iso-org-a", 1, 0, 0),
      env.DB.prepare(
        "INSERT INTO repo_topic_links (team_id, repo_full_name, org_login, thread_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).bind("team-iso-b", "iso-org-b/repo", "iso-org-b", 2, 0, 0),
    ]);

    const rowsForA = await env.DB.prepare(
      "SELECT repo_full_name FROM repo_topic_links WHERE team_id = ?",
    )
      .bind("team-iso-a")
      .all<{ repo_full_name: string }>();

    expect(rowsForA.results.map((r) => r.repo_full_name)).toEqual([
      "iso-org-a/repo",
    ]);
  });
});
