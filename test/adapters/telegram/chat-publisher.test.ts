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

describe("createTelegramChatPublisher failures", () => {
  const operations = [
    ["post", (p: ReturnType<typeof makePublisher>) => p.post(555, 42, "hello")],
    ["pin", (p: ReturnType<typeof makePublisher>) => p.pin(555, 77)],
    ["unpin", (p: ReturnType<typeof makePublisher>) => p.unpin(555, 77)],
  ] as const;

  const failures = [
    ["a 429", { ok: false, error_code: 429, description: "Too Many Requests: retry after 5" }, "rate-limited"],
    ["a 400 (e.g. topic deleted)", { ok: false, error_code: 400, description: "Bad Request: message thread not found" }, "rejected"],
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
