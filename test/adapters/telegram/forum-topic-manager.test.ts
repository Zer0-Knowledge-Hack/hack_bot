import { Api } from "grammy";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ForumTopicCreateError } from "../../../src/domain/errors";
import type { TopicCreateFailure } from "../../../src/domain/ports";
import {
  createTelegramForumTopicManager,
  resetTopicIconCache,
} from "../../../src/adapters/telegram/forum-topic-manager";
import { stubTelegramApi } from "../../support/telegram-stub";

// hackathon-participation design.md "Interfaces / Contracts":
// `create` classifies a failed createForumTopic into a fixed failure code.

afterEach(() => {
  resetTopicIconCache();
  vi.unstubAllGlobals();
});

function makeManager() {
  return createTelegramForumTopicManager(new Api("000000000:TEST-TOKEN-NOT-REAL"));
}

function fail(code: number, description: string) {
  return { ok: false, error_code: code, description };
}

describe("createTelegramForumTopicManager.create", () => {
  it("creates the topic and returns its message_thread_id", async () => {
    const calls = stubTelegramApi((method) =>
      method === "createForumTopic"
        ? { message_thread_id: 4321, name: "🏆 Meridian", icon_color: 7322096 }
        : undefined,
    );

    const threadId = await makeManager().create(-1001234, "🏆 Meridian");

    expect(threadId).toBe(4321);
    expect(calls.find((c) => c.method === "createForumTopic")?.body).toMatchObject({
      chat_id: -1001234,
      name: "🏆 Meridian",
    });
  });

  const failures: Array<[string, unknown, TopicCreateFailure]> = [
    ["not enough rights", fail(400, "Bad Request: not enough rights to create a topic"), "no-rights"],
    ["CHAT_ADMIN_REQUIRED", fail(400, "Bad Request: CHAT_ADMIN_REQUIRED"), "no-rights"],
    ["chat_admin_required (lowercase)", fail(400, "Bad Request: chat_admin_required"), "no-rights"],
    ["the chat is not a forum", fail(400, "Bad Request: the chat is not a forum"), "not-forum"],
    ["CHANNEL_FORUM_MISSING", fail(400, "Bad Request: CHANNEL_FORUM_MISSING"), "not-forum"],
    ["a 429", fail(429, "Too Many Requests: retry after 5"), "rate-limited"],
    ["another 400", fail(400, "Bad Request: TOPIC_NAME_INVALID"), "rejected"],
    ["a 403", fail(403, "Forbidden: bot was kicked from the supergroup chat"), "rejected"],
    ["a 502", fail(502, "Bad Gateway"), "unavailable"],
    ["a 500", fail(500, "Internal Server Error"), "unavailable"],
  ];

  for (const [label, response, expected] of failures) {
    it(`classifies ${label} as ${expected} without leaking Telegram's description`, async () => {
      stubTelegramApi(() => response);

      const err = await makeManager().create(-1001234, "x").catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ForumTopicCreateError);
      expect((err as ForumTopicCreateError).failure).toBe(expected);
      expect((err as ForumTopicCreateError).message).not.toContain(
        (response as { description: string }).description,
      );
    });
  }

  it("classifies a network failure (HttpError) as unavailable", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("network down");
    });

    const err = await makeManager().create(-1001234, "x").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ForumTopicCreateError);
    expect((err as ForumTopicCreateError).failure).toBe("unavailable");
  });

  it("classifies an aborted call (timeout) as unavailable", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });

    const err = await makeManager().create(-1001234, "x").catch((e: unknown) => e);

    expect((err as ForumTopicCreateError).failure).toBe("unavailable");
  });

  it("bounds the call with an abort signal", async () => {
    let signal: AbortSignal | null | undefined;
    vi.stubGlobal("fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal;
      return new Response(
        JSON.stringify({ ok: true, result: { message_thread_id: 1, name: "x", icon_color: 1 } }),
        { headers: { "content-type": "application/json" } },
      );
    });

    await makeManager().create(-1001234, "x");

    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
  });
});

describe("createTelegramForumTopicManager.create with an icon hint", () => {
  const OPTS = { iconEmoji: "🏆", fallbackName: "🏆 Meridian" };
  const stickers = [
    { emoji: "📰", custom_emoji_id: "111" },
    { emoji: "🏆", custom_emoji_id: "5309" },
  ];
  const topicResult = { message_thread_id: 9, name: "Meridian", icon_color: 1 };

  it("uses the matching sticker as the icon and keeps the plain name", async () => {
    const calls = stubTelegramApi((method) =>
      method === "getForumTopicIconStickers" ? stickers : topicResult,
    );

    const threadId = await makeManager().create(-1001234, "Meridian", OPTS);

    expect(threadId).toBe(9);
    expect(calls.map((c) => c.method)).toEqual(["getForumTopicIconStickers", "createForumTopic"]);
    expect(calls[1]?.body).toMatchObject({
      chat_id: -1001234,
      name: "Meridian",
      icon_custom_emoji_id: "5309",
    });
  });

  it("matches ignoring the U+FE0F variation selector on either side", async () => {
    const calls = stubTelegramApi((method) =>
      method === "getForumTopicIconStickers"
        ? [{ emoji: "❤️", custom_emoji_id: "77" }]
        : topicResult,
    );

    await makeManager().create(-1001234, "Meridian", { iconEmoji: "❤", fallbackName: "❤ M" });

    expect(calls[1]?.body).toMatchObject({ name: "Meridian", icon_custom_emoji_id: "77" });
  });

  it("creates the topic with the fallback name and no icon when nothing matches", async () => {
    const calls = stubTelegramApi((method) =>
      method === "getForumTopicIconStickers"
        ? [{ emoji: "📰", custom_emoji_id: "111" }]
        : topicResult,
    );

    await makeManager().create(-1001234, "Meridian", OPTS);

    const body = calls.find((c) => c.method === "createForumTopic")?.body as Record<string, unknown>;
    expect(body.name).toBe("🏆 Meridian");
    expect(body).not.toHaveProperty("icon_custom_emoji_id");
  });

  it("still creates the topic with the fallback name when the sticker fetch fails", async () => {
    const calls = stubTelegramApi((method) =>
      method === "getForumTopicIconStickers" ? fail(500, "Internal Server Error") : topicResult,
    );

    const threadId = await makeManager().create(-1001234, "Meridian", OPTS);

    expect(threadId).toBe(9);
    const body = calls.find((c) => c.method === "createForumTopic")?.body as Record<string, unknown>;
    expect(body.name).toBe("🏆 Meridian");
    expect(body).not.toHaveProperty("icon_custom_emoji_id");
  });

  it("fetches the icon list once across two creates", async () => {
    const calls = stubTelegramApi((method) =>
      method === "getForumTopicIconStickers" ? stickers : topicResult,
    );
    const manager = makeManager();

    await manager.create(-1001234, "A", OPTS);
    await manager.create(-1001234, "B", OPTS);

    expect(calls.filter((c) => c.method === "getForumTopicIconStickers")).toHaveLength(1);
    expect(calls.filter((c) => c.method === "createForumTopic")).toHaveLength(2);
  });

  it("does not cache a failed fetch: the next create refetches", async () => {
    let fetches = 0;
    const calls = stubTelegramApi((method) => {
      if (method !== "getForumTopicIconStickers") return topicResult;
      fetches += 1;
      return fetches === 1 ? fail(500, "Internal Server Error") : stickers;
    });
    const manager = makeManager();

    await manager.create(-1001234, "A", OPTS);
    await manager.create(-1001234, "B", OPTS);

    expect(fetches).toBe(2);
    const creates = calls.filter((c) => c.method === "createForumTopic");
    expect(creates[0]?.body).not.toHaveProperty("icon_custom_emoji_id");
    expect(creates[1]?.body).toMatchObject({ name: "B", icon_custom_emoji_id: "5309" });
  });

  it("does not fetch icons when no hint is given", async () => {
    const calls = stubTelegramApi(() => topicResult);

    await makeManager().create(-1001234, "Plain");

    expect(calls.map((c) => c.method)).toEqual(["createForumTopic"]);
  });
});
