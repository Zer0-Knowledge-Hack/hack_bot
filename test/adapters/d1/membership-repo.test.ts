import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createD1MembershipRepo } from "../../../src/adapters/d1/membership-repo";
import { AlreadyExistsError } from "../../../src/domain/errors";
import { asMemberId, asMembershipId, asTeamId } from "../../../src/domain/ids";
import { fakeClock } from "../../fakes";

// A real UUID generator, not the resetting `fakeIdGen()` counter: D1 storage
// in this test file is NOT isolated per test (shared Miniflare instance), so
// a counter that restarts at "id-1" for every `makeRepo()` call would
// collide with audit_log's PRIMARY KEY across unrelated tests.
function makeRepo() {
  return createD1MembershipRepo(env.DB, { newId: () => crypto.randomUUID() }, fakeClock());
}

async function seedTeam(teamId: string, chatId: number) {
  await env.DB.prepare(
    "INSERT INTO teams (id, telegram_chat_id, created_at) VALUES (?, ?, ?)",
  )
    .bind(teamId, chatId, 0)
    .run();
}

async function seedMember(memberId: string, telegramUserId: number) {
  await env.DB.prepare(
    "INSERT INTO members (id, telegram_user_id, created_at) VALUES (?, ?, ?)",
  )
    .bind(memberId, telegramUserId, 0)
    .run();
}

async function seedMembership(
  membershipId: string,
  teamId: string,
  memberId: string,
  role: "member" | "admin",
) {
  await env.DB.prepare(
    "INSERT INTO memberships (id, team_id, member_id, role, joined_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(membershipId, teamId, memberId, role, 0)
    .run();
}

describe("createD1MembershipRepo — cross-tenant isolation", () => {
  it("get() never returns a membership from a different team", async () => {
    await seedTeam("team-a", 1);
    await seedTeam("team-b", 2);
    await seedMember("member-a", 100);
    await seedMembership("m-a", "team-a", "member-a", "member");

    const repo = makeRepo();
    const crossTenant = await repo.get(asTeamId("team-b"), asMembershipId("m-a"));

    expect(crossTenant).toBeNull();
  });

  it("listByTeam() only returns rows scoped to the requested team_id", async () => {
    await seedTeam("team-c", 3);
    await seedTeam("team-d", 4);
    await seedMember("member-c", 300);
    await seedMember("member-d", 400);
    await seedMembership("m-c", "team-c", "member-c", "admin");
    await seedMembership("m-d", "team-d", "member-d", "admin");

    const repo = makeRepo();
    const teamCRows = await repo.listByTeam(asTeamId("team-c"));

    expect(teamCRows).toHaveLength(1);
    expect(teamCRows[0]?.id).toBe("m-c");
  });
});

describe("createD1MembershipRepo — create()", () => {
  it("writes the membership and one self-actor audit row atomically", async () => {
    await seedTeam("team-create", 10);
    await seedMember("member-create", 1000);
    const repo = makeRepo();

    await repo.create(
      {
        id: asMembershipId("m-create"),
        teamId: asTeamId("team-create"),
        memberId: asMemberId("member-create"),
        role: "admin",
        joinedAt: 0,
      },
      { field: "role", oldValue: null, newValue: "admin", keyVersion: null },
    );

    const membership = await repo.get(asTeamId("team-create"), asMembershipId("m-create"));
    expect(membership?.role).toBe("admin");

    const audits = await env.DB.prepare("SELECT * FROM audit_log WHERE team_id = ?")
      .bind("team-create")
      .all<{ actor_membership_id: string; target_membership_id: string }>();
    expect(audits.results).toHaveLength(1);
    expect(audits.results[0]?.actor_membership_id).toBe("m-create");
    expect(audits.results[0]?.target_membership_id).toBe("m-create");
  });

  it("translates a UNIQUE(team_id, member_id) violation into AlreadyExistsError", async () => {
    await seedTeam("team-join-dup", 11);
    await seedMember("member-join-dup", 1100);
    const repo = makeRepo();
    const audit = { field: "role", oldValue: null, newValue: "member", keyVersion: null };

    await repo.create(
      {
        id: asMembershipId("m-join-1"),
        teamId: asTeamId("team-join-dup"),
        memberId: asMemberId("member-join-dup"),
        role: "member",
        joinedAt: 0,
      },
      audit,
    );

    await expect(
      repo.create(
        {
          id: asMembershipId("m-join-2"),
          teamId: asTeamId("team-join-dup"),
          memberId: asMemberId("member-join-dup"),
          role: "member",
          joinedAt: 0,
        },
        audit,
      ),
    ).rejects.toThrow(AlreadyExistsError);
  });
});

describe("createD1MembershipRepo — changeRole() atomic requireRemainingAdmin contract", () => {
  it("applies the role change and writes exactly one audit row when more than one admin remains", async () => {
    await seedTeam("team-role-ok", 20);
    await seedMember("member-1", 2001);
    await seedMember("member-2", 2002);
    await seedMembership("m-admin-1", "team-role-ok", "member-1", "admin");
    await seedMembership("m-admin-2", "team-role-ok", "member-2", "admin");
    const repo = makeRepo();

    const result = await repo.changeRole(
      asTeamId("team-role-ok"),
      asMembershipId("m-admin-1"),
      "member",
      asMembershipId("m-admin-2"),
      { field: "role", oldValue: "admin", newValue: "member", keyVersion: null },
      { requireRemainingAdmin: true },
    );

    expect(result.applied).toBe(true);
    const membership = await repo.get(asTeamId("team-role-ok"), asMembershipId("m-admin-1"));
    expect(membership?.role).toBe("member");

    const audits = await env.DB.prepare("SELECT * FROM audit_log WHERE team_id = ?")
      .bind("team-role-ok")
      .all<{ actor_membership_id: string; target_membership_id: string }>();
    expect(audits.results).toHaveLength(1);
    expect(audits.results[0]?.actor_membership_id).toBe("m-admin-2");
    expect(audits.results[0]?.target_membership_id).toBe("m-admin-1");
  });

  it("refuses to demote the last remaining admin and writes NO audit row", async () => {
    await seedTeam("team-role-last", 21);
    await seedMember("member-last", 2100);
    await seedMembership("m-last-admin", "team-role-last", "member-last", "admin");
    const repo = makeRepo();

    const result = await repo.changeRole(
      asTeamId("team-role-last"),
      asMembershipId("m-last-admin"),
      "member",
      asMembershipId("m-last-admin"),
      { field: "role", oldValue: "admin", newValue: "member", keyVersion: null },
      { requireRemainingAdmin: true },
    );

    expect(result.applied).toBe(false);
    const membership = await repo.get(asTeamId("team-role-last"), asMembershipId("m-last-admin"));
    expect(membership?.role).toBe("admin");

    const audits = await env.DB.prepare("SELECT * FROM audit_log WHERE team_id = ?")
      .bind("team-role-last")
      .all();
    expect(audits.results).toHaveLength(0);
  });

  it("keeps at least one admin when two demotions race concurrently (real D1 atomicity)", async () => {
    await seedTeam("team-role-race", 22);
    await seedMember("member-r1", 2201);
    await seedMember("member-r2", 2202);
    await seedMembership("m-race-1", "team-role-race", "member-r1", "admin");
    await seedMembership("m-race-2", "team-role-race", "member-r2", "admin");
    const repo = makeRepo();
    const draft = (oldValue: string) => ({
      field: "role",
      oldValue,
      newValue: "member",
      keyVersion: null,
    });

    const [r1, r2] = await Promise.all([
      repo.changeRole(
        asTeamId("team-role-race"),
        asMembershipId("m-race-1"),
        "member",
        asMembershipId("m-race-1"),
        draft("admin"),
        { requireRemainingAdmin: true },
      ),
      repo.changeRole(
        asTeamId("team-role-race"),
        asMembershipId("m-race-2"),
        "member",
        asMembershipId("m-race-2"),
        draft("admin"),
        { requireRemainingAdmin: true },
      ),
    ]);

    const remaining = await repo.listByTeam(asTeamId("team-role-race"));
    const admins = remaining.filter((m) => m.role === "admin");
    expect(admins).toHaveLength(1);
    expect([r1.applied, r2.applied].filter(Boolean)).toHaveLength(1);
  });
});
