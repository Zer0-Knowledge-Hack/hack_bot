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
      "members",
      "memberships",
      "profile_fields",
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
});
