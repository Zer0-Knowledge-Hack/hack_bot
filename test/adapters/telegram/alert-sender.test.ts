import { Api } from "grammy";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AlertSendFailedError } from "../../../src/domain/errors";
import { createTelegramAlertSender } from "../../../src/adapters/telegram/alert-sender";
import { stubTelegramApi } from "../../support/telegram-stub";

// design.md "Sender": grammY's Api.sendMessage with message_thread_id, no
// parse_mode (plain text — MarkdownV2/HTML escaping bugs could break
// sending on a title with special characters). A send failure surfaces as
// AlertSendFailedError, never thrown as the raw grammY error, so
// routeGithubEvent can report "send-failed" instead of a 500 (design.md
// "GitHub route status policy").

// Same seam as test/http/webhook-e2e.test.ts (READ-002: the stub itself is
// shared — see test/support/telegram-stub.ts): grammY's Api resolves the
// bare `fetch` identifier at construction time, so stubbing
// globalThis.fetch intercepts the outbound call — no production seam
// needed.

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createTelegramAlertSender", () => {
  it("calls sendMessage with the chat id, text and message_thread_id", async () => {
    const calls = stubTelegramApi();
    const api = new Api("000000000:TEST-TOKEN-NOT-REAL");
    const sender = createTelegramAlertSender(api);

    await sender.send(555, 42, "hello");

    const call = calls.find((c) => c.method === "sendMessage");
    expect(call).toBeTruthy();
    expect(call?.body).toMatchObject({
      chat_id: 555,
      text: "hello",
      message_thread_id: 42,
    });
  });

  it("surfaces a failed send as AlertSendFailedError, not the raw grammY error", async () => {
    stubTelegramApi(() => ({ ok: false, error_code: 400, description: "Bad Request: message thread not found" }));
    const api = new Api("000000000:TEST-TOKEN-NOT-REAL");
    const sender = createTelegramAlertSender(api);

    await expect(sender.send(555, 42, "hello")).rejects.toBeInstanceOf(AlertSendFailedError);
  });
});

// PR4 correction (RES-001): the raw grammY failure is classified into a
// fixed, non-sensitive `failureClass` so the caller's log can tell a
// transient failure (429, 5xx/network) apart from a permanent one (other
// 4xx), while the spec's 2xx/no-retry behavior stays exactly the same —
// only what gets logged changes. Telegram's `description` (which can
// contain operator-specific detail) must never leak into the thrown
// error's message.
describe("createTelegramAlertSender — failure classification (RES-001)", () => {
  it("classifies a 429 as rate-limited", async () => {
    stubTelegramApi(() => ({
      ok: false,
      error_code: 429,
      description: "Too Many Requests: retry after 5",
    }));
    const api = new Api("000000000:TEST-TOKEN-NOT-REAL");
    const sender = createTelegramAlertSender(api);

    const err = await sender.send(555, 42, "hello").catch((e) => e);
    expect(err).toBeInstanceOf(AlertSendFailedError);
    expect((err as AlertSendFailedError).failureClass).toBe("rate-limited");
    expect((err as AlertSendFailedError).message).not.toMatch(/Too Many Requests/);
  });

  it("classifies any other 4xx as rejected (e.g. the topic was deleted)", async () => {
    stubTelegramApi(() => ({
      ok: false,
      error_code: 400,
      description: "Bad Request: message thread not found",
    }));
    const api = new Api("000000000:TEST-TOKEN-NOT-REAL");
    const sender = createTelegramAlertSender(api);

    const err = await sender.send(555, 42, "hello").catch((e) => e);
    expect(err).toBeInstanceOf(AlertSendFailedError);
    expect((err as AlertSendFailedError).failureClass).toBe("rejected");
    expect((err as AlertSendFailedError).message).not.toMatch(/message thread not found/);
  });

  it("classifies a Telegram-side 5xx (error_code >= 500) as telegram-unavailable", async () => {
    stubTelegramApi(() => ({
      ok: false,
      error_code: 500,
      description: "Internal Server Error",
    }));
    const api = new Api("000000000:TEST-TOKEN-NOT-REAL");
    const sender = createTelegramAlertSender(api);

    const err = await sender.send(555, 42, "hello").catch((e) => e);
    expect(err).toBeInstanceOf(AlertSendFailedError);
    expect((err as AlertSendFailedError).failureClass).toBe("telegram-unavailable");
  });

  it("classifies a network/transport failure (grammY HttpError) as telegram-unavailable", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("network down — should never appear in the thrown message");
    });
    const api = new Api("000000000:TEST-TOKEN-NOT-REAL");
    const sender = createTelegramAlertSender(api);

    const err = await sender.send(555, 42, "hello").catch((e) => e);
    expect(err).toBeInstanceOf(AlertSendFailedError);
    expect((err as AlertSendFailedError).failureClass).toBe("telegram-unavailable");
    expect((err as AlertSendFailedError).message).not.toMatch(/network down/);
  });
});
