import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../../src/index";
import type { Env } from "../../src/index";
import type { AnalysisJobMessage } from "../../src/domain/entities";
import { stubTelegramApi } from "../support/telegram-stub";

// task 10.3/10.4: `/hackathon <url>` driven through the real Hono route,
// `buildBot` (real composition root: D1 repos, queue adapter, chat
// publisher) and `registerCommands`. Only the outbound Telegram HTTP and the
// queue binding are faked, so this proves the wiring, not just the command.

const WEBHOOK_SECRET = (env as unknown as { WEBHOOK_SECRET: string }).WEBHOOK_SECRET;

let nextUpdateId = 5000;
function commandUpdate(command: string, chatId: number, userId: number, args = "") {
  const commandText = `/${command}`;
  return {
    update_id: nextUpdateId++,
    message: {
      message_id: nextUpdateId,
      date: 0,
      chat: { id: chatId, type: "supergroup", title: "E2E group" },
      from: { id: userId, is_bot: false, first_name: "User" },
      text: args ? `${commandText} ${args}` : commandText,
      entities: [{ offset: 0, length: commandText.length, type: "bot_command" }],
    },
  };
}

function fakeQueue(opts: { throws?: boolean } = {}) {
  const sent: AnalysisJobMessage[] = [];
  return {
    sent,
    binding: {
      send: async (message: AnalysisJobMessage) => {
        if (opts.throws) throw new Error("queue unavailable");
        sent.push(message);
      },
    },
  };
}

function post(body: unknown, queue: { send: (m: AnalysisJobMessage) => Promise<void> }) {
  return app.request(
    "/telegram/webhook",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": WEBHOOK_SECRET,
      },
      body: JSON.stringify(body),
    },
    { ...env, HACKATHON_QUEUE: queue } as unknown as Env,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /telegram/webhook — /hackathon <url> through real composition", () => {
  it("reserves the slot in D1, enqueues the job, acks, then refuses a second run while one is in flight", async () => {
    const calls = stubTelegramApi();
    const queue = fakeQueue();
    const chatId = 555_101;
    const userId = 900_101;

    expect((await post(commandUpdate("setup", chatId, userId), queue.binding)).status).toBe(200);
    const res = await post(
      commandUpdate("hackathon", chatId, userId, "https://example.com/event"),
      queue.binding,
    );

    expect(res.status).toBe(200);
    const replies = calls.filter((c) => c.method === "sendMessage").map((c) => (c.body as { text: string }).text);
    expect(replies.at(-1)).toMatch(/^Analyzing example\.com/);
    expect(queue.sent).toMatchObject([
      { v: 1, chatId, threadId: null, fetchUrl: "https://example.com/event" },
    ]);
    const job = await env.DB.prepare(
      "SELECT status, fetch_url FROM hackathon_analysis_jobs WHERE id = ?",
    )
      .bind(queue.sent[0]!.jobId)
      .first();
    expect(job).toEqual({ status: "queued", fetch_url: "https://example.com/event" });

    // The lease is real (D1): a second fresh run is refused, nothing enqueued.
    await post(commandUpdate("hackathon", chatId, userId, "https://example.com/other"), queue.binding);
    const repliesAfter = calls.filter((c) => c.method === "sendMessage").map((c) => (c.body as { text: string }).text);
    expect(repliesAfter.at(-1)).toMatch(/already running/i);
    expect(queue.sent).toHaveLength(1);
  });

  it("refunds the reserved slot and replies 'could not start' when the real queue adapter fails", async () => {
    const calls = stubTelegramApi();
    const queue = fakeQueue({ throws: true });
    const chatId = 555_102;
    const userId = 900_102;

    await post(commandUpdate("setup", chatId, userId), queue.binding);
    const res = await post(
      commandUpdate("hackathon", chatId, userId, "https://example.com/event"),
      queue.binding,
    );

    expect(res.status).toBe(200);
    const replies = calls.filter((c) => c.method === "sendMessage").map((c) => (c.body as { text: string }).text);
    expect(replies.at(-1)).toMatch(/could not start the analysis/i);
    const usage = await env.DB.prepare(
      `SELECT u.runs AS runs FROM hackathon_analysis_usage u
         JOIN teams t ON t.id = u.team_id WHERE t.telegram_chat_id = ?`,
    )
      .bind(chatId)
      .first<{ runs: number }>();
    expect(usage?.runs).toBe(0);
  });

  it("re-shows nothing for an unknown slug and lists an empty team, both from D1", async () => {
    const calls = stubTelegramApi();
    const queue = fakeQueue();
    const chatId = 555_103;
    const userId = 900_103;

    await post(commandUpdate("setup", chatId, userId), queue.binding);
    await post(commandUpdate("hackathon", chatId, userId, "nope"), queue.binding);
    await post(commandUpdate("hackathons", chatId, userId), queue.binding);

    const replies = calls.filter((c) => c.method === "sendMessage").map((c) => (c.body as { text: string }).text);
    expect(replies.at(-2)).toBe("No analysis with that slug. See /hackathons.");
    expect(replies.at(-1)).toBe("No hackathons analyzed yet.");
    expect(queue.sent).toHaveLength(0);
  });
});
