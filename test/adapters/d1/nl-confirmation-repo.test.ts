import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createD1NlConfirmationRepo } from "../../../src/adapters/d1/nl-confirmation-repo";
import { asMembershipId, asTeamId } from "../../../src/domain/ids";
import { NL_CONFIRM_TTL_MS } from "../../../src/domain/nl/confirmation";
import type { NlConfirmation } from "../../../src/domain/nl/confirmation";

async function seedTeamAndMembership(
  teamId: string,
  membershipId: string,
  chatId: number,
) {
  await env.DB.prepare(
    "INSERT INTO teams (id, telegram_chat_id, created_at) VALUES (?, ?, ?)",
  )
    .bind(teamId, chatId, 0)
    .run();
  await env.DB.prepare(
    "INSERT INTO members (id, telegram_user_id, created_at) VALUES (?, ?, ?)",
  )
    .bind(`member-${teamId}`, chatId, 0)
    .run();
  await env.DB.prepare(
    "INSERT INTO memberships (id, team_id, member_id, role, joined_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(membershipId, teamId, `member-${teamId}`, "admin", 0)
    .run();
}

function confirmation(
  overrides: Partial<NlConfirmation> & Pick<NlConfirmation, "id">,
): NlConfirmation {
  return {
    teamId: asTeamId("team-conf"),
    chatId: 500,
    threadId: null,
    actorMembershipId: asMembershipId("mem-conf"),
    intent: "join_team",
    slots: {},
    confirmMessageId: 42,
    expiresAt: 1_000_000 + NL_CONFIRM_TTL_MS,
    consumedAt: null,
    createdAt: 1_000_000,
    ...overrides,
  };
}

describe("createD1NlConfirmationRepo", () => {
  it("creates and finds by id and confirm message", async () => {
    await seedTeamAndMembership("team-conf", "mem-conf", 500);
    const repo = createD1NlConfirmationRepo(env.DB);
    const row = confirmation({ id: "conf-1", slots: { slug: "meridian" } });
    await repo.create(row);

    expect(await repo.findById("conf-1")).toMatchObject({
      id: "conf-1",
      intent: "join_team",
      slots: { slug: "meridian" },
      confirmMessageId: 42,
    });
    expect(await repo.findByConfirmMessage(500, 42)).toMatchObject({ id: "conf-1" });
    expect(await repo.findByConfirmMessage(500, 99)).toBeNull();
  });

  it("tryConsume CAS wins once then fails", async () => {
    await seedTeamAndMembership("team-cas", "mem-cas", 501);
    const repo = createD1NlConfirmationRepo(env.DB);
    await repo.create(
      confirmation({
        id: "conf-cas",
        teamId: asTeamId("team-cas"),
        chatId: 501,
        actorMembershipId: asMembershipId("mem-cas"),
        expiresAt: 2_000_000,
      }),
    );

    expect(await repo.tryConsume("conf-cas", 1_500_000)).toBe(true);
    expect(await repo.tryConsume("conf-cas", 1_500_001)).toBe(false);
    const row = await repo.findById("conf-cas");
    expect(row?.consumedAt).toBe(1_500_000);
  });

  it("tryConsume fails when expired", async () => {
    await seedTeamAndMembership("team-exp", "mem-exp", 502);
    const repo = createD1NlConfirmationRepo(env.DB);
    await repo.create(
      confirmation({
        id: "conf-exp",
        teamId: asTeamId("team-exp"),
        chatId: 502,
        actorMembershipId: asMembershipId("mem-exp"),
        expiresAt: 1_000_000,
        createdAt: 1_000_000 - NL_CONFIRM_TTL_MS,
      }),
    );

    expect(await repo.tryConsume("conf-exp", 1_000_000)).toBe(false);
    expect(await repo.tryConsume("conf-exp", 1_000_001)).toBe(false);
  });

  it("cancel CAS consumes without a second win", async () => {
    await seedTeamAndMembership("team-can", "mem-can", 503);
    const repo = createD1NlConfirmationRepo(env.DB);
    await repo.create(
      confirmation({
        id: "conf-can",
        teamId: asTeamId("team-can"),
        chatId: 503,
        actorMembershipId: asMembershipId("mem-can"),
        expiresAt: 2_000_000,
      }),
    );

    expect(await repo.cancel("conf-can", 1_100_000)).toBe(true);
    expect(await repo.tryConsume("conf-can", 1_100_001)).toBe(false);
  });

  it("enforces TTL window of at most 10 minutes on fresh rows in tests", async () => {
    expect(NL_CONFIRM_TTL_MS).toBe(10 * 60 * 1000);
  });
});
