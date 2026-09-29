import { Api } from "grammy";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublishFailedError } from "../../../src/domain/errors";
import { createTelegramChatPublisher } from "../../../src/adapters/telegram/chat-publisher";
import { stubTelegramApi } from "../../support/telegram-stub";

// task 10.1 (design.md "Interfaces / Contracts": `ChatPublisher` — `post`
// throws `PublishFailedError(AlertSendFailureClass)`): grammY's Api with no
// `parse_mode` (plain text, spec "Plain Text Replies"), the optional forum
// thread, pin and unpin. Same stub seam as alert-sender.test.ts.

afterEach(() => {
  vi.unstubAllGlobals();
});

function makePublisher() {
  return createTelegramChatPublisher(new Api("000000000:TEST-TOKEN-NOT-REAL"));
}

describe("createTelegramChatPublisher.post", () => {
  it("sends plain text to the general chat without a thread and returns the message id", async () => {
    const calls = stubTelegramApi((method) =>
      method === "sendMessage" ? { message_id: 901, date: 0, chat: { id: 555, type: "supergroup" } } : undefined,
    );

    const messageId = await makePublisher().post(555, null, "hello");

    const call = calls.find((c) => c.method === "sendMessage");
    expect(messageId).toBe(901);
    expect(call?.body).toMatchObject({ chat_id: 555, text: "hello" });
    expect(call?.body).not.toHaveProperty("message_thread_id");
    expect(call?.body).not.toHaveProperty("parse_mode");
  });

  it("sends into the given forum topic when a thread id is supplied", async () => {
    const calls = stubTelegramApi();

    await makePublisher().post(555, 42, "hello");

    expect(calls.find((c) => c.method === "sendMessage")?.body).toMatchObject({
      chat_id: 555,
      text: "hello",
      message_thread_id: 42,
    });
  });

  it("disables link previews so a page URL does not bloat the post", async () => {
    const calls = stubTelegramApi();

    await makePublisher().post(555, null, "https://example.com/event");

    expect(calls.find((c) => c.method === "sendMessage")?.body).toMatchObject({
      link_preview_options: { is_disabled: true },
    });
  });

  it("bounds the call with an abort signal (design.md: Telegram publish 10 s)", async () => {
    let signal: AbortSignal | null | undefined;
    vi.stubGlobal("fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal;
      return new Response(
        JSON.stringify({ ok: true, result: { message_id: 1, date: 0, chat: { id: 1, type: "supergroup" } } }),
        { headers: { "content-type": "application/json" } },
      );
    });

    await makePublisher().post(555, null, "hello");

    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
  });
});

describe("createTelegramChatPublisher.post options (participation button)", () => {
  it("keeps the no-option payload free of any reply_markup", async () => {
    const calls = stubTelegramApi();

    await makePublisher().post(555, null, "hello");

    expect(calls.find((c) => c.method === "sendMessage")?.body).not.toHaveProperty("reply_markup");
  });

  it("does not add a keyboard when the options carry no participateSlug", async () => {
    const calls = stubTelegramApi();

    await makePublisher().post(555, null, "hello", {});

    expect(calls.find((c) => c.method === "sendMessage")?.body).not.toHaveProperty("reply_markup");
  });

  it("adds one button labelled \"✅ Participamos\" carrying hp:<slug> when participateSlug is set", async () => {
    const calls = stubTelegramApi();

    await makePublisher().post(555, null, "hello", { participateSlug: "meridian-hacks" });

    const body = calls.find((c) => c.method === "sendMessage")?.body as {
      reply_markup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
    };
    expect(body).toMatchObject({ chat_id: 555, text: "hello" });
    expect(body.reply_markup.inline_keyboard).toEqual([
      [{ text: "✅ Participamos", callback_data: "hp:meridian-hacks" }],
    ]);
  });

  it("keeps callback_data within Telegram's 64-byte limit for the longest slug", async () => {
    const calls = stubTelegramApi();
    const slug = "a".repeat(40);

    await makePublisher().post(555, 42, "hello", { participateSlug: slug });

    const body = calls.find((c) => c.method === "sendMessage")?.body as {
      message_thread_id: number;
      reply_markup: { inline_keyboard: Array<Array<{ callback_data: string }>> };
    };
    const data = body.reply_markup.inline_keyboard[0]?.[0]?.callback_data ?? "";
    expect(data).toBe(`hp:${slug}`);
    expect(new TextEncoder().encode(data).length).toBeLessThanOrEqual(64);
    expect(body.message_thread_id).toBe(42);
  });
});

describe("createTelegramChatPublisher.clearButtons", () => {
  it("edits the message's reply markup without sending a reply_markup (removes the keyboard)", async () => {
    const calls = stubTelegramApi();

    await makePublisher().clearButtons(555, 901);

    const call = calls.find((c) => c.method === "editMessageReplyMarkup");
    expect(call?.body).toMatchObject({ chat_id: 555, message_id: 901 });
    expect(call?.body).not.toHaveProperty("reply_markup");
  });

  it("becomes PublishFailedError on a Telegram rejection without leaking its description", async () => {
    stubTelegramApi(() => ({
      ok: false,
      error_code: 400,
      description: "Bad Request: message to edit not found",
    }));

    const err = await makePublisher().clearButtons(555, 901).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PublishFailedError);
    expect((err as PublishFailedError).failureClass).toBe("rejected");
    expect((err as PublishFailedError).message).not.toContain("message to edit not found");
  });

  it("classifies a 5xx as telegram-unavailable", async () => {
    stubTelegramApi(() => ({ ok: false, error_code: 502, description: "Bad Gateway" }));

    const err = await makePublisher().clearButtons(555, 901).catch((e: unknown) => e);

    expect((err as PublishFailedError).failureClass).toBe("telegram-unavailable");
  });
});

describe("createTelegramChatPublisher.pin / unpin", () => {
  it("pins the message without notifying the chat", async () => {
    const calls = stubTelegramApi();

    await makePublisher().pin(555, 77);

    expect(calls.find((c) => c.method === "pinChatMessage")?.body).toMatchObject({
      chat_id: 555,
      message_id: 77,
      disable_notification: true,
    });
  });

  it("unpins exactly the given message", async () => {
    const calls = stubTelegramApi();

    await makePublisher().unpin(555, 78);

    expect(calls.find((c) => c.method === "unpinChatMessage")?.body).toMatchObject({
      chat_id: 555,
      message_id: 78,
    });
  });
});

// R3-001: only a 400 whose description says the thread is gone is
// "thread-gone" (the deleted-topic signal). Every other 4xx, including a
// closed topic or missing rights on a LIVE topic, stays "rejected".
describe("createTelegramChatPublisher.post thread-gone classification", () => {
  const cases = [
    ["400 message thread not found", 400, "Bad Request: message thread not found", "thread-gone"],
    ["400 TOPIC_ID_INVALID", 400, "Bad Request: TOPIC_ID_INVALID", "thread-gone"],
    ["400 TOPIC_DELETED", 400, "Bad Request: TOPIC_DELETED", "thread-gone"],
    ["400 TOPIC_CLOSED (live, closed topic)", 400, "Bad Request: TOPIC_CLOSED", "rejected"],
    ["403 not enough rights to send", 403, "Forbidden: not enough rights to send text messages to the chat", "rejected"],
    ["403 with thread-not-found wording", 403, "Forbidden: message thread not found", "rejected"],
  ] as const;

  for (const [label, code, description, failureClass] of cases) {
    it(`${label} becomes PublishFailedError(${failureClass}) without leaking the description`, async () => {
      stubTelegramApi(() => ({ ok: false, error_code: code, description }));

      const err = await makePublisher().post(555, 42, "hello").catch((e: unknown) => e);

      expect(err).toBeInstanceOf(PublishFailedError);
      expect((err as PublishFailedError).failureClass).toBe(failureClass);
      expect((err as PublishFailedError).message).not.toContain(description);
    });
  }

  it("pin keeps a 400 thread-not-found as rejected (only post signals a gone thread)", async () => {
    stubTelegramApi(() => ({ ok: false, error_code: 400, description: "Bad Request: message thread not found" }));

    const err = await makePublisher().pin(555, 77).catch((e: unknown) => e);

    expect((err as PublishFailedError).failureClass).toBe("rejected");
  });
});

describe("createTelegramChatPublisher failures", () => {
  const operations = [
    ["post", (p: ReturnType<typeof makePublisher>) => p.post(555, 42, "hello")],
    ["pin", (p: ReturnType<typeof makePublisher>) => p.pin(555, 77)],
    ["unpin", (p: ReturnType<typeof makePublisher>) => p.unpin(555, 77)],
  ] as const;

  const failures = [
    ["a 429", { ok: false, error_code: 429, description: "Too Many Requests: retry after 5" }, "rate-limited"],
    ["a 400 (e.g. chat not found)", { ok: false, error_code: 400, description: "Bad Request: chat not found" }, "rejected"],
    ["a 403 (bot lacks pin rights)", { ok: false, error_code: 403, description: "Forbidden: not enough rights to pin a message" }, "rejected"],
    ["a 5xx", { ok: false, error_code: 502, description: "Bad Gateway" }, "telegram-unavailable"],
  ] as const;

  for (const [opName, run] of operations) {
    for (const [label, response, failureClass] of failures) {
      it(`${opName}: ${label} becomes PublishFailedError(${failureClass}) without leaking Telegram's description`, async () => {
        stubTelegramApi(() => response);

        const err = await run(makePublisher()).catch((e: unknown) => e);

        expect(err).toBeInstanceOf(PublishFailedError);
        expect((err as PublishFailedError).failureClass).toBe(failureClass);
        expect((err as PublishFailedError).message).not.toContain(response.description);
      });
    }
  }

  it("classifies a network failure as telegram-unavailable and never echoes its text", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("network down — must never appear in the thrown message");
    });

    const err = await makePublisher().post(555, null, "hello").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PublishFailedError);
    expect((err as PublishFailedError).failureClass).toBe("telegram-unavailable");
    expect((err as PublishFailedError).message).not.toMatch(/network down/);
  });
});
