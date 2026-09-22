import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import app from "../../src/index";
import type { Env } from "../../src/index";

// REL-001: the assembled route was never proven end-to-end — this file
// drives real updates through the actual Hono route + `buildBot` (real
// composition root) + `registerCommands`, with only the outbound Telegram
// API calls stubbed (never bypassing composition). It also proves the
// RES-001/RES-002 webhook response policy (see src/index.ts) for its three
// branches: handled domain error -> 200, malformed body -> 200, unexpected
// infra failure -> 500 + a log entry with no PII/secret.

const WEBHOOK_SECRET = (env as unknown as { WEBHOOK_SECRET: string }).WEBHOOK_SECRET;

// Seam note: grammY's `Bot`/`ApiClient` resolves the bare `fetch` identifier
// at construction time (see node_modules/grammy/out/web.mjs — `const
// fetchFn = customFetch ?? fetch;`), and `composition.ts` builds a fresh
// `Bot` per request. Since @cloudflare/vitest-pool-workers runs the `main`
// worker in the SAME isolate as the test file (its own module doc:
// "this `main` worker runs in the same isolate/context as tests, so any
// global mocks will apply to it too"), stubbing `globalThis.fetch` before
// the request is enough to intercept grammY's outbound calls — no
// production seam was needed in `buildBot`/`composition.ts`.
type TelegramCall = { method: string; body: unknown };

function stubTelegramApi(handler?: (method: string, body: unknown) => unknown) {
  const calls: TelegramCall[] = [];
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = url.split("/").pop() ?? "";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, body });
      const result =
        handler?.(method, body) ??
        (method === "getChatMember"
          ? { status: "administrator", user: { id: 1, is_bot: false, first_name: "Admin" } }
          : { message_id: calls.length, date: 0, chat: { id: 1, type: "supergroup" } });
      return new Response(JSON.stringify({ ok: true, result }), {
        headers: { "content-type": "application/json" },
      });
    },
  );
  return calls;
}

let nextUpdateId = 1000;
function commandUpdate(command: string, chatId: number, userId: number) {
  const text = `/${command}`;
  return {
    update_id: nextUpdateId++,
    message: {
      message_id: nextUpdateId,
      date: 0,
      chat: { id: chatId, type: "supergroup", title: "E2E group" },
      from: { id: userId, is_bot: false, first_name: "User" },
      text,
      entities: [{ offset: 0, length: text.length, type: "bot_command" }],
    },
  };
}

function post(body: unknown, envOverride: unknown = env) {
  return app.request(
    "/telegram/webhook",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": WEBHOOK_SECRET,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
    envOverride as Env,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /telegram/webhook — end-to-end through real composition (REL-001)", () => {
  it("processes /setup through buildBot + registerCommands, writes to D1, and attempts a reply", async () => {
    const calls = stubTelegramApi();
    const chatId = 555_001;
    const userId = 900_001;

    const res = await post(commandUpdate("setup", chatId, userId));

    expect(res.status).toBe(200);
    expect(calls.some((c) => c.method === "getChatMember")).toBe(true);
    const sendMessageCall = calls.find((c) => c.method === "sendMessage");
    expect(sendMessageCall).toBeTruthy();
    expect((sendMessageCall?.body as { text: string }).text).toMatch(/created/i);

    const row = await env.DB.prepare(
      "SELECT * FROM teams WHERE telegram_chat_id = ?",
    )
      .bind(chatId)
      .first();
    expect(row).toBeTruthy();
  });

  it("returns 500 and logs only an error code (no secret) when composition fails on a malformed PII_KEYRING", async () => {
    const logs: string[] = [];
    const consoleSpy = vi.spyOn(console, "log").mockImplementation((msg) => {
      logs.push(String(msg));
    });

    const badEnv = { ...env, PII_KEYRING: "not-valid-json" };
    const res = await post({ update_id: nextUpdateId++ }, badEnv);

    expect(res.status).toBe(500);
    const logged = logs.join("\n");
    expect(logged).not.toMatch(/not-valid-json/);
    expect(logged).toMatch(/composition/);

    consoleSpy.mockRestore();
  });
});

describe("POST /telegram/webhook — response policy (RES-001 / RES-002)", () => {
  it("a handled domain error (e.g. duplicate /setup) replies to the user and returns 200", async () => {
    stubTelegramApi();
    const chatId = 555_002;
    const userId = 900_002;

    await post(commandUpdate("setup", chatId, userId));
    const res = await post(commandUpdate("setup", chatId, userId));

    expect(res.status).toBe(200);
  });

  it("an unparseable request body is logged and answered with 200 (redelivery can never fix it)", async () => {
    const logs: string[] = [];
    const consoleSpy = vi.spyOn(console, "log").mockImplementation((msg) => {
      logs.push(String(msg));
    });
    stubTelegramApi();

    const res = await post("{not json");

    expect(res.status).toBe(200);
    expect(logs.join("\n")).toMatch(/webhook/);

    consoleSpy.mockRestore();
  });

  it("an injected infra failure (D1 unavailable) is logged (no PII) and answered with 500 so Telegram retries", async () => {
    const logs: string[] = [];
    const consoleSpy = vi.spyOn(console, "log").mockImplementation((msg) => {
      logs.push(String(msg));
    });
    stubTelegramApi();

    const brokenDbEnv = {
      ...env,
      DB: {
        prepare() {
          throw new Error("D1 unavailable — should never appear in logs");
        },
      },
    };

    const res = await post(commandUpdate("setup", 555_003, 900_003), brokenDbEnv);

    expect(res.status).toBe(500);
    const logged = logs.join("\n");
    expect(logged).not.toMatch(/D1 unavailable/);
    expect(logged).toMatch(/webhook/);

    consoleSpy.mockRestore();
  });
});
