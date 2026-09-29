import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../../src/index";
import type { Env } from "../../src/index";
import { createD1HackathonAnalysisRepo } from "../../src/adapters/d1/hackathon-analysis-repo";
import type { AnalysisJobMessage } from "../../src/domain/entities";
import { asTeamId } from "../../src/domain/ids";
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
    expect(replies.at(-1)).toBe("Analizando example.com… el resultado se publicará aquí.");
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
    expect(repliesAfter.at(-1)).toBe("Ya hay un análisis en curso para este equipo. Espera su resultado.");
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
    expect(replies.at(-1)).toBe(
      "No se pudo iniciar el análisis; inténtalo de nuevo en un minuto. No se contó en el límite diario.",
    );
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
    expect(replies.at(-2)).toBe("No hay ningún análisis con ese slug. Consulta /hackathons.");
    expect(replies.at(-1)).toBe("Todavía no se ha analizado ningún hackathon.");
    expect(queue.sent).toHaveLength(0);
  });
});

// hackathon-participation: `/hackathon join <slug>` through the real composition
// root (D1 repos, ForumTopicManager and ChatPublisher adapters).
describe("POST /telegram/webhook — /hackathon join through real composition", () => {
  const stubForum = () =>
    stubTelegramApi((method) => {
      if (method === "createForumTopic") return { message_thread_id: 4242, name: "x", icon_color: 0 };
      return undefined;
    });

  async function seedAnalysis(chatId: number, slug: string, generalMessageId: number | null) {
    const team = await env.DB.prepare("SELECT id FROM teams WHERE telegram_chat_id = ?")
      .bind(chatId)
      .first<{ id: string }>();
    const repo = createD1HackathonAnalysisRepo(env.DB);
    await repo.save({
      id: `e2e-${chatId}-${slug}`,
      teamId: asTeamId(team!.id),
      slug,
      sourceUrl: `https://example.com/${slug}`,
      normalizedUrl: `https://example.com/${slug}`,
      fields: {
        name: { value: "Meridian Hack", snippet: "", confidence: 0.9 },
        format: null,
        location: null,
        teamSize: null,
        submissionDeadline: null,
        startDate: null,
        endDate: null,
        resultsDate: null,
        prizes: null,
        tracks: null,
        eligibility: null,
      },
      suggestedRepos: [],
      threadId: null,
      pinnedMessageId: null,
      generalMessageId: null,
      createdAt: 0,
      updatedAt: 0,
    });
    if (generalMessageId !== null) {
      await repo.setGeneralMessageId(asTeamId(team!.id), `e2e-${chatId}-${slug}`, generalMessageId);
    }
  }

  it("creates the topic, links it in D1, clears the stored button and confirms in General", async () => {
    const calls = stubForum();
    const queue = fakeQueue();
    const chatId = -1_005_551_041;
    const userId = 900_141;

    await post(commandUpdate("setup", chatId, userId), queue.binding);
    await seedAnalysis(chatId, "meridian", 321);
    const res = await post(commandUpdate("hackathon", chatId, userId, "join meridian"), queue.binding);

    expect(res.status).toBe(200);
    const row = await env.DB.prepare(
      "SELECT thread_id, general_message_id FROM hackathon_analyses WHERE id = ?",
    )
      .bind(`e2e-${chatId}-meridian`)
      .first();
    expect(row).toEqual({ thread_id: 4242, general_message_id: 321 });
    expect(calls.filter((c) => c.method === "createForumTopic")).toHaveLength(1);
    expect(calls.find((c) => c.method === "createForumTopic")?.body).toMatchObject({
      name: "🏆 Meridian Hack",
    });
    const clear = calls.find((c) => c.method === "editMessageReplyMarkup");
    expect(clear?.body).toMatchObject({ chat_id: chatId, message_id: 321 });
    const texts = calls.filter((c) => c.method === "sendMessage").map((c) => c.body as { text: string; message_thread_id?: number });
    expect(texts.at(-1)?.text).toBe("✅ Participamos en Meridian Hack → https://t.me/c/5551041/4242");
    expect(texts.at(-1)?.message_thread_id).toBeUndefined();
    expect(queue.sent).toHaveLength(0);
  });

  it("a redelivered join creates no second topic and replies 'ya tiene tema'", async () => {
    const calls = stubForum();
    const queue = fakeQueue();
    const chatId = -1_005_551_042;
    const userId = 900_142;

    await post(commandUpdate("setup", chatId, userId), queue.binding);
    await seedAnalysis(chatId, "meridian", null);
    await post(commandUpdate("hackathon", chatId, userId, "join meridian"), queue.binding);
    await post(commandUpdate("hackathon", chatId, userId, "join meridian"), queue.binding);

    expect(calls.filter((c) => c.method === "createForumTopic")).toHaveLength(1);
    const texts = calls.filter((c) => c.method === "sendMessage").map((c) => (c.body as { text: string }).text);
    expect(texts.at(-1)).toBe("Este hackathon ya tiene tema: https://t.me/c/5551042/4242");
  });

  it("replies with the missing-rights text and stores nothing when Telegram refuses", async () => {
    const calls = stubTelegramApi((method) =>
      method === "createForumTopic"
        ? { ok: false, error_code: 400, description: "Bad Request: not enough rights to create a topic" }
        : undefined,
    );
    const queue = fakeQueue();
    const chatId = -1_005_551_043;
    const userId = 900_143;

    await post(commandUpdate("setup", chatId, userId), queue.binding);
    await seedAnalysis(chatId, "meridian", null);
    const res = await post(commandUpdate("hackathon", chatId, userId, "join meridian"), queue.binding);

    expect(res.status).toBe(200);
    const texts = calls.filter((c) => c.method === "sendMessage").map((c) => (c.body as { text: string }).text);
    expect(texts.at(-1)).toBe(
      "No puedo crear temas: concede al bot el permiso «Administrar temas» y vuelve a intentarlo.",
    );
    const row = await env.DB.prepare("SELECT thread_id, topic_claim_until FROM hackathon_analyses WHERE id = ?")
      .bind(`e2e-${chatId}-meridian`)
      .first();
    expect(row).toEqual({ thread_id: null, topic_claim_until: 0 });
  });
});

// hackathon-participation (PR2): the `hp:<slug>` callback through the real
// route, composition root, D1 and adapters (telegram-webhook spec: Command-Only
// Routing).
describe("POST /telegram/webhook — hp: callback through real composition", () => {
  const stubForum = () =>
    stubTelegramApi((method) => {
      if (method === "createForumTopic") return { message_thread_id: 4242, name: "x", icon_color: 0 };
      return undefined;
    });

  function callbackUpdate(chatId: number, userId: number, data: string, messageId = 321) {
    return {
      update_id: nextUpdateId++,
      callback_query: {
        id: `cb-${nextUpdateId}`,
        from: { id: userId, is_bot: false, first_name: "User" },
        chat_instance: "e2e",
        data,
        message: {
          message_id: messageId,
          date: 0,
          chat: { id: chatId, type: "supergroup", title: "E2E group" },
        },
      },
    };
  }

  async function seed(chatId: number, generalMessageId: number | null) {
    const team = await env.DB.prepare("SELECT id FROM teams WHERE telegram_chat_id = ?")
      .bind(chatId)
      .first<{ id: string }>();
    const teamId = asTeamId(team!.id);
    const repo = createD1HackathonAnalysisRepo(env.DB);
    const id = `e2e-cb-${chatId}`;
    await repo.save({
      id,
      teamId,
      slug: "meridian",
      sourceUrl: "https://example.com/meridian",
      normalizedUrl: "https://example.com/meridian",
      fields: {
        name: { value: "Meridian Hack", snippet: "", confidence: 0.9 },
        format: null,
        location: null,
        teamSize: null,
        submissionDeadline: null,
        startDate: null,
        endDate: null,
        resultsDate: null,
        prizes: null,
        tracks: null,
        eligibility: null,
      },
      suggestedRepos: [],
      threadId: null,
      pinnedMessageId: null,
      generalMessageId: null,
      createdAt: 0,
      updatedAt: 0,
    });
    if (generalMessageId !== null) await repo.setGeneralMessageId(teamId, id, generalMessageId);
    return id;
  }

  const threadOf = (id: string) =>
    env.DB.prepare("SELECT thread_id FROM hackathon_analyses WHERE id = ?").bind(id).first();

  it("an admin tap creates the topic, confirms in General, answers the callback and removes the button", async () => {
    const calls = stubForum();
    const queue = fakeQueue();
    const chatId = -1_005_552_001;
    const userId = 900_201;

    await post(commandUpdate("setup", chatId, userId), queue.binding);
    const id = await seed(chatId, 321);
    const res = await post(callbackUpdate(chatId, userId, "hp:meridian"), queue.binding);

    expect(res.status).toBe(200);
    expect(await threadOf(id)).toEqual({ thread_id: 4242 });
    expect(calls.filter((c) => c.method === "createForumTopic")).toHaveLength(1);
    expect(calls.filter((c) => c.method === "answerCallbackQuery")).toHaveLength(1);
    expect(calls.filter((c) => c.method === "editMessageReplyMarkup").map((c) => c.body)).toEqual([
      expect.objectContaining({ chat_id: chatId, message_id: 321 }),
    ]);
    const texts = calls.filter((c) => c.method === "sendMessage").map((c) => (c.body as { text: string }).text);
    expect(texts.at(-1)).toBe("✅ Participamos en Meridian Hack → https://t.me/c/5552001/4242");
  });

  it("a non-admin tap gets the alert and nothing changes", async () => {
    const calls = stubForum();
    const queue = fakeQueue();
    const chatId = -1_005_552_002;
    const adminId = 900_202;
    const memberId = 900_203;

    await post(commandUpdate("setup", chatId, adminId), queue.binding);
    await post(commandUpdate("join", chatId, memberId), queue.binding);
    const id = await seed(chatId, 321);
    const res = await post(callbackUpdate(chatId, memberId, "hp:meridian"), queue.binding);

    expect(res.status).toBe(200);
    const answers = calls.filter((c) => c.method === "answerCallbackQuery").map((c) => c.body);
    expect(answers).toEqual([
      expect.objectContaining({
        text: "Solo un administrador del equipo puede confirmar la participación.",
        show_alert: true,
      }),
    ]);
    expect(calls.some((c) => c.method === "createForumTopic")).toBe(false);
    expect(calls.some((c) => c.method === "editMessageReplyMarkup")).toBe(false);
    expect(await threadOf(id)).toEqual({ thread_id: null });
  });

  it("a redelivered tap creates no second topic", async () => {
    const calls = stubForum();
    const queue = fakeQueue();
    const chatId = -1_005_552_003;
    const userId = 900_204;

    await post(commandUpdate("setup", chatId, userId), queue.binding);
    await seed(chatId, null);
    const update = callbackUpdate(chatId, userId, "hp:meridian");
    await post(update, queue.binding);
    await post(update, queue.binding);

    expect(calls.filter((c) => c.method === "createForumTopic")).toHaveLength(1);
    const texts = calls.filter((c) => c.method === "sendMessage").map((c) => (c.body as { text: string }).text);
    expect(texts.at(-1)).toBe("Este hackathon ya tiene tema: https://t.me/c/5552003/4242");
  });

  it.each([
    ["a malformed slug", "hp:Bad_Slug"],
    ["a foreign prefix", "zz:meridian"],
  ])("%s is ignored with 200 and no Telegram call", async (_label, data) => {
    const calls = stubForum();
    const queue = fakeQueue();
    const chatId = -1_005_552_004;
    const userId = 900_205;

    await post(commandUpdate("setup", chatId, userId), queue.binding);
    const id = await seed(chatId, 321);
    const before = calls.length;
    const res = await post(callbackUpdate(chatId, userId, data), queue.binding);

    expect(res.status).toBe(200);
    expect(calls.slice(before)).toEqual([]);
    expect(await threadOf(id)).toEqual({ thread_id: null });
  });
});
