import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

// WEBHOOK_SECRET test value is set in vitest.config.ts (miniflare bindings).
const WEBHOOK_SECRET = (env as unknown as { WEBHOOK_SECRET: string }).WEBHOOK_SECRET;

function post(body: unknown, headers: Record<string, string> = {}) {
  return SELF.fetch("https://example.com/telegram/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /telegram/webhook — secret-token validation (telegram-webhook spec)", () => {
  it("rejects a request with a missing secret header", async () => {
    const res = await post({ update_id: 1 });
    expect(res.status).toBe(401);
  });

  it("rejects a request with a mismatched secret header", async () => {
    const res = await post(
      { update_id: 1 },
      { "X-Telegram-Bot-Api-Secret-Token": "wrong-secret" },
    );
    expect(res.status).toBe(401);
  });

  it("rejects a mismatched header even when it has the same length as the real secret", async () => {
    const sameLength = "x".repeat(WEBHOOK_SECRET.length);
    const res = await post(
      { update_id: 1 },
      { "X-Telegram-Bot-Api-Secret-Token": sameLength },
    );
    expect(res.status).toBe(401);
  });

  it("accepts a valid secret and ignores an unrecognized (non-command) update without error", async () => {
    // No bot_command entity — the telegram-webhook spec's "Unrecognized
    // update ignored" scenario. No reply is triggered, so this never calls
    // out to the real Telegram API.
    const res = await post(
      {
        update_id: 42,
        message: {
          message_id: 1,
          date: 0,
          chat: { id: 111, type: "private" },
          from: { id: 222, is_bot: false, first_name: "Alice" },
          text: "just chatting, not a command",
        },
      },
      { "X-Telegram-Bot-Api-Secret-Token": WEBHOOK_SECRET },
    );
    expect(res.status).toBe(200);
  });
});
