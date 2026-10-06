import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createD1NlClassifyQuota } from "../../../src/adapters/d1/nl-classify-quota";
import { asTeamId } from "../../../src/domain/ids";
import { NL_CLASSIFY_DAILY_CAP } from "../../../src/domain/nl/intents";

async function seedTeam(teamId: string, chatId: number) {
  await env.DB.prepare(
    "INSERT INTO teams (id, telegram_chat_id, created_at) VALUES (?, ?, ?)",
  )
    .bind(teamId, chatId, 0)
    .run();
}

async function quotaCount(teamId: string, day: string) {
  return env.DB.prepare(
    "SELECT count FROM nl_classify_quota WHERE team_id = ? AND day_utc = ?",
  )
    .bind(teamId, day)
    .first<{ count: number }>();
}

describe("createD1NlClassifyQuota", () => {
  it("reserve succeeds until the daily cap, then returns false", async () => {
    await seedTeam("team-nl-cap", 900);
    const quota = createD1NlClassifyQuota(env.DB);
    const team = asTeamId("team-nl-cap");
    const day = "2026-10-05";
    const cap = 3;

    expect(await quota.reserve(team, day, cap)).toBe(true);
    expect(await quota.reserve(team, day, cap)).toBe(true);
    expect(await quota.reserve(team, day, cap)).toBe(true);
    expect(await quota.reserve(team, day, cap)).toBe(false);

    expect((await quotaCount("team-nl-cap", day))?.count).toBe(3);
  });

  it("uses the domain default cap of 100 for boundary checks", async () => {
    await seedTeam("team-nl-100", 901);
    const quota = createD1NlClassifyQuota(env.DB);
    const team = asTeamId("team-nl-100");
    const day = "2026-10-05";

    await env.DB.prepare(
      "INSERT INTO nl_classify_quota (team_id, day_utc, count) VALUES (?, ?, ?)",
    )
      .bind("team-nl-100", day, NL_CLASSIFY_DAILY_CAP - 1)
      .run();

    expect(await quota.reserve(team, day, NL_CLASSIFY_DAILY_CAP)).toBe(true);
    expect(await quota.reserve(team, day, NL_CLASSIFY_DAILY_CAP)).toBe(false);
    expect((await quotaCount("team-nl-100", day))?.count).toBe(NL_CLASSIFY_DAILY_CAP);
  });

  it("isolates counters per team and UTC day", async () => {
    await seedTeam("team-nl-a", 902);
    await seedTeam("team-nl-b", 903);
    const quota = createD1NlClassifyQuota(env.DB);

    expect(await quota.reserve(asTeamId("team-nl-a"), "2026-10-05", 1)).toBe(true);
    expect(await quota.reserve(asTeamId("team-nl-a"), "2026-10-05", 1)).toBe(false);
    expect(await quota.reserve(asTeamId("team-nl-b"), "2026-10-05", 1)).toBe(true);
    expect(await quota.reserve(asTeamId("team-nl-a"), "2026-10-06", 1)).toBe(true);
  });
});
