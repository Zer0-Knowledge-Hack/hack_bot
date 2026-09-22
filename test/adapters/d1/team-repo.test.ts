import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createD1TeamRepo } from "../../../src/adapters/d1/team-repo";
import { AlreadyExistsError } from "../../../src/domain/errors";
import { asMembershipId, asTeamId } from "../../../src/domain/ids";
import { fakeClock } from "../../fakes";

// Real UUIDs, not the resetting `fakeIdGen()` counter — D1 storage in this
// file is shared across tests, so a restarting counter would collide with
// audit_log's PRIMARY KEY across unrelated tests.
function makeRepo() {
  return createD1TeamRepo(env.DB, { newId: () => crypto.randomUUID() }, fakeClock());
}

async function seedTeamAndAdmin(teamId: string, chatId: number, membershipId: string) {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO teams (id, telegram_chat_id, created_at) VALUES (?, ?, ?)",
    ).bind(teamId, chatId, 0),
    env.DB.prepare(
      "INSERT INTO members (id, telegram_user_id, created_at) VALUES (?, ?, ?)",
    ).bind(`member-${membershipId}`, chatId * 1000, 0),
    env.DB.prepare(
      "INSERT INTO memberships (id, team_id, member_id, role, joined_at) VALUES (?, ?, ?, 'admin', ?)",
    ).bind(membershipId, teamId, `member-${membershipId}`, 0),
  ]);
}

describe("createD1TeamRepo", () => {
  it("creates a team and finds it by chat id", async () => {
    const repo = makeRepo();
    const team = {
      id: asTeamId("team-create-1"),
      chatId: 4242,
      dataTopicThreadId: null,
      createdAt: 100,
    };

    await repo.create(team);
    const found = await repo.findByChatId(4242);

    expect(found).toEqual(team);
  });

  it("translates a UNIQUE(telegram_chat_id) violation into AlreadyExistsError", async () => {
    const repo = makeRepo();
    const chatId = 5151;
    await repo.create({
      id: asTeamId("team-dup-a"),
      chatId,
      dataTopicThreadId: null,
      createdAt: 0,
    });

    await expect(
      repo.create({
        id: asTeamId("team-dup-b"),
        chatId,
        dataTopicThreadId: null,
        createdAt: 0,
      }),
    ).rejects.toThrow(AlreadyExistsError);
  });

  it("bindDataChannel updates the thread id and writes one audit row atomically", async () => {
    const teamId = "team-bind-1";
    const adminId = "membership-bind-1";
    await seedTeamAndAdmin(teamId, 6161, adminId);
    const repo = makeRepo();

    await repo.bindDataChannel(asTeamId(teamId), 77, asMembershipId(adminId), {
      field: "data_topic_thread_id",
      oldValue: null,
      newValue: "77",
      keyVersion: null,
    });

    const team = await repo.get(asTeamId(teamId));
    expect(team?.dataTopicThreadId).toBe(77);

    const auditRows = await env.DB.prepare(
      "SELECT * FROM audit_log WHERE team_id = ?",
    )
      .bind(teamId)
      .all<{ actor_membership_id: string; target_membership_id: string; new_value: string }>();
    expect(auditRows.results).toHaveLength(1);
    expect(auditRows.results[0]?.actor_membership_id).toBe(adminId);
    expect(auditRows.results[0]?.target_membership_id).toBe(adminId);
    expect(auditRows.results[0]?.new_value).toBe("77");
  });
});
