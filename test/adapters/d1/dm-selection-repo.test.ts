import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createD1DmSelectionRepo } from "../../../src/adapters/d1/dm-selection-repo";
import { asTeamId } from "../../../src/domain/ids";
import { fakeClock } from "../../fakes";

// Real UUIDs, not the resetting `fakeIdGen()` counter — D1 storage in this
// file is shared across tests (see team-repo.test.ts for the same note).
async function seedTeam(teamId: string, chatId: number) {
  await env.DB.prepare(
    "INSERT INTO teams (id, telegram_chat_id, created_at) VALUES (?, ?, ?)",
  )
    .bind(teamId, chatId, 0)
    .run();
}

describe("createD1DmSelectionRepo", () => {
  it("returns null when the caller has no stored selection", async () => {
    const repo = createD1DmSelectionRepo(env.DB);

    expect(await repo.get(90001)).toBeNull();
  });

  it("stores and retrieves a selection scoped to its telegram user id, with an injected-clock TTL", async () => {
    const teamId = "team-dm-sel-1";
    await seedTeam(teamId, 90002);
    const repo = createD1DmSelectionRepo(env.DB);
    const clock = fakeClock();
    const expiresAt = clock.now() + 15 * 60 * 1000;

    await repo.set({ telegramUserId: 90002, teamId: asTeamId(teamId), expiresAt });
    const found = await repo.get(90002);

    expect(found).toEqual({
      telegramUserId: 90002,
      teamId: asTeamId(teamId),
      expiresAt,
    });
  });

  it("does not leak one user's selection to another (tenant/user scoped)", async () => {
    const teamA = "team-dm-sel-a";
    const teamB = "team-dm-sel-b";
    await seedTeam(teamA, 90003);
    await seedTeam(teamB, 90004);
    const repo = createD1DmSelectionRepo(env.DB);

    await repo.set({ telegramUserId: 90003, teamId: asTeamId(teamA), expiresAt: 1_000 });
    await repo.set({ telegramUserId: 90004, teamId: asTeamId(teamB), expiresAt: 2_000 });

    expect((await repo.get(90003))?.teamId).toBe(asTeamId(teamA));
    expect((await repo.get(90004))?.teamId).toBe(asTeamId(teamB));
  });

  it("overwrites a prior selection for the same user (upsert, e.g. picking a new team)", async () => {
    const teamOld = "team-dm-sel-old";
    const teamNew = "team-dm-sel-new";
    await seedTeam(teamOld, 90005);
    await seedTeam(teamNew, 90006);
    const repo = createD1DmSelectionRepo(env.DB);

    await repo.set({ telegramUserId: 90005, teamId: asTeamId(teamOld), expiresAt: 1_000 });
    await repo.set({ telegramUserId: 90005, teamId: asTeamId(teamNew), expiresAt: 5_000 });

    const found = await repo.get(90005);
    expect(found?.teamId).toBe(asTeamId(teamNew));
    expect(found?.expiresAt).toBe(5_000);
  });
});
