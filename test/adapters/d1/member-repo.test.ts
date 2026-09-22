import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createD1MemberRepo } from "../../../src/adapters/d1/member-repo";
import { asMemberId } from "../../../src/domain/ids";

describe("createD1MemberRepo", () => {
  it("upserts a member and finds it by telegram_user_id", async () => {
    const repo = createD1MemberRepo(env.DB);
    const member = {
      id: asMemberId("member-1"),
      telegramUserId: 9001,
      createdAt: 10,
    };

    await repo.upsert(member);
    const found = await repo.findByTelegramUserId(9001);

    expect(found).toEqual(member);
  });

  it("does not duplicate or reassign the id on a repeated upsert for the same telegram_user_id", async () => {
    const repo = createD1MemberRepo(env.DB);
    await repo.upsert({ id: asMemberId("member-2"), telegramUserId: 9002, createdAt: 20 });
    // A second upsert attempt with a different id for the same telegram
    // user MUST NOT reassign member-2's id — existing FKs (memberships)
    // point at the original id.
    await repo.upsert({ id: asMemberId("member-2-conflict"), telegramUserId: 9002, createdAt: 20 });

    const found = await repo.findByTelegramUserId(9002);
    expect(found?.id).toBe("member-2");
  });

  it("RES-002: returns the persisted member (first-writer-wins id) from every upsert racing for the same telegram_user_id", async () => {
    const repo = createD1MemberRepo(env.DB);

    const first = await repo.upsert({
      id: asMemberId("member-3-first"),
      telegramUserId: 9003,
      createdAt: 30,
    });
    // Simulates a second concurrent caller that generated its own local id
    // before discovering the row already exists — the D1 adapter's
    // ON CONFLICT DO NOTHING must not silently return void here: the
    // caller needs the ACTUALLY persisted member (with the first writer's
    // id) to create a membership row that satisfies the FK.
    const second = await repo.upsert({
      id: asMemberId("member-3-second"),
      telegramUserId: 9003,
      createdAt: 31,
    });

    expect(first.id).toBe("member-3-first");
    expect(second.id).toBe("member-3-first");
    expect(second).toEqual(first);
  });
});
