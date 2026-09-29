import { Api } from "grammy";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ForumTopicCreateError } from "../../../src/domain/errors";
import type { TopicCreateFailure } from "../../../src/domain/ports";
import { createTelegramForumTopicManager } from "../../../src/adapters/telegram/forum-topic-manager";
import { stubTelegramApi } from "../../support/telegram-stub";

// hackathon-participation design.md decision 2 + "Interfaces / Contracts":
// `create` classifies a failed createForumTopic into a fixed failure code;
// `probe` maps sendChatAction(typing, message_thread_id) to live / deleted /
// unknown and never throws (an ambiguous result is treated as live).

afterEach(() => {
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

describe("createTelegramForumTopicManager.probe", () => {
  it("returns live when sendChatAction succeeds, using typing with message_thread_id", async () => {
    const calls = stubTelegramApi((method) => (method === "sendChatAction" ? true : undefined));

    const result = await makeManager().probe(-1001234, 4321);

    expect(result).toBe("live");
    expect(calls.find((c) => c.method === "sendChatAction")?.body).toMatchObject({
      chat_id: -1001234,
      action: "typing",
      message_thread_id: 4321,
    });
  });

  const deleted = [
    "Bad Request: message thread not found",
    "Bad Request: TOPIC_ID_INVALID",
    "Bad Request: TOPIC_DELETED",
    "bad request: Message Thread Not Found",
  ];
  for (const description of deleted) {
    it(`returns deleted for a 400 "${description}"`, async () => {
      stubTelegramApi(() => fail(400, description));

      expect(await makeManager().probe(-1001234, 4321)).toBe("deleted");
    });
  }

  const ambiguous: Array<[string, unknown]> = [
    ["another 400", fail(400, "Bad Request: chat not found")],
    ["a 403", fail(403, "Forbidden: bot is not a member of the supergroup chat")],
    ["a 429", fail(429, "Too Many Requests: retry after 5")],
    ["a 502", fail(502, "Bad Gateway")],
    // The same deleted-topic text on a non-400 must not count as a positive signal.
    ["a non-400 with a deleted-looking description", fail(403, "message thread not found")],
  ];
  for (const [label, response] of ambiguous) {
    it(`returns unknown (treated as live) for ${label}`, async () => {
      stubTelegramApi(() => response);

      expect(await makeManager().probe(-1001234, 4321)).toBe("unknown");
    });
  }

  it("returns unknown on a network failure or timeout and never throws", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("network down");
    });

    await expect(makeManager().probe(-1001234, 4321)).resolves.toBe("unknown");
  });
});
