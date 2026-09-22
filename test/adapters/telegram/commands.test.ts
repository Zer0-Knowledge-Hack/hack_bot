import { Bot } from "grammy";
import type { Update } from "grammy/types";
import { describe, expect, it } from "vitest";
import { registerCommands } from "../../../src/adapters/telegram/commands";
import { createSafeLogger } from "../../../src/adapters/log/safe-logger";
import {
  fakeChatAdminChecker,
  fakeClock,
  fakeDmSelectionRepo,
  fakeIdGen,
  fakeMemberRepo,
  fakeMembershipRepo,
  fakeProfileRepo,
  fakeTeamRepo,
} from "../../fakes";

// Same technique as test/runtime-assumptions/grammy-api-stub.test.ts: a
// real grammY `Bot`, outbound Telegram API calls intercepted with a
// transformer instead of hitting the network (mandatory point 7). This
// exercises the actual production `registerCommands` wiring end-to-end —
// only the network boundary is stubbed.
function makeBot(admins: Array<{ chatId: number; userId: number }> = []) {
  const bot = new Bot("000000000:TEST-TOKEN-NOT-REAL", {
    botInfo: {
      id: 1,
      is_bot: true,
      first_name: "TestBot",
      username: "test_bot",
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: false,
      allows_users_to_create_topics: false,
      can_manage_bots: false,
      supports_join_request_queries: false,
    },
  });

  const replies: Array<{ chatId: number; text: string }> = [];
  bot.api.config.use((_prev, method, payload) => {
    if (method === "sendMessage") {
      const p = payload as { chat_id: number; text: string };
      replies.push({ chatId: p.chat_id, text: p.text });
      return Promise.resolve({
        ok: true,
        result: { message_id: replies.length, date: 0, chat: { id: p.chat_id, type: "private" } },
      } as never);
    }
    return Promise.resolve({ ok: true, result: {} } as never);
  });

  const teamRepo = fakeTeamRepo();
  const memberRepo = fakeMemberRepo();
  const membershipRepo = fakeMembershipRepo(memberRepo);
  const profileRepo = fakeProfileRepo();
  const dmSelectionRepo = fakeDmSelectionRepo();
  const chatAdminChecker = fakeChatAdminChecker(admins);
  const deps = {
    teamRepo,
    memberRepo,
    membershipRepo,
    profileRepo,
    dmSelectionRepo,
    chatAdminChecker,
    clock: fakeClock(),
    idGen: fakeIdGen(),
    logger: createSafeLogger(),
  };
  registerCommands(bot, deps);
  return { bot, replies, deps };
}

let nextUpdateId = 1;
function commandUpdate(
  command: string,
  chatId: number,
  userId: number,
  opts: { threadId?: number; chatType?: "private" | "supergroup" } = {},
): Update {
  const text = `/${command}`;
  return {
    update_id: nextUpdateId++,
    message: {
      message_id: nextUpdateId,
      date: 0,
      chat: { id: chatId, type: opts.chatType ?? "supergroup", title: "Test group" } as never,
      from: { id: userId, is_bot: false, first_name: "User" },
      text,
      entities: [{ offset: 0, length: text.length, type: "bot_command" }],
      ...(opts.threadId !== undefined ? { message_thread_id: opts.threadId } : {}),
    },
  } as Update;
}

function textUpdate(chatId: number, userId: number): Update {
  return {
    update_id: nextUpdateId++,
    message: {
      message_id: nextUpdateId,
      date: 0,
      chat: { id: chatId, type: "supergroup", title: "Test group" } as never,
      from: { id: userId, is_bot: false, first_name: "User" },
      text: "hello there",
    },
  } as Update;
}

describe("registerCommands — routing (telegram-webhook spec)", () => {
  it("ignores an update that is not a recognized command", async () => {
    const { bot, replies } = makeBot();
    await bot.handleUpdate(textUpdate(1, 1));
    expect(replies).toHaveLength(0);
  });
});

describe("registerCommands — /setup (team-registration spec)", () => {
  it("creates a team and assigns the caller as the first admin", async () => {
    const { bot, replies, deps } = makeBot([{ chatId: 10, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));

    expect(deps.teamRepo.rows).toHaveLength(1);
    expect(deps.membershipRepo.rows[0]?.role).toBe("admin");
    expect(replies[0]?.text).toMatch(/created/i);
  });

  it("refuses when a team already exists for the chat", async () => {
    const { bot, replies } = makeBot([{ chatId: 10, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));
    await bot.handleUpdate(commandUpdate("setup", 10, 1));

    expect(replies[1]?.text).toMatch(/already/i);
  });

  it("refuses when the caller is not a verified group admin", async () => {
    const { bot, replies, deps } = makeBot([]); // no admins configured
    await bot.handleUpdate(commandUpdate("setup", 20, 2));

    expect(deps.teamRepo.rows).toHaveLength(0);
    expect(replies[0]?.text).toMatch(/admin/i);
  });
});

describe("registerCommands — /join (team-membership spec)", () => {
  it("creates a membership for a new user", async () => {
    const { bot, replies, deps } = makeBot([{ chatId: 10, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));
    await bot.handleUpdate(commandUpdate("join", 10, 3));

    expect(deps.membershipRepo.rows).toHaveLength(2);
    expect(replies[1]?.text).toMatch(/joined/i);
  });

  it("refuses a duplicate join without creating a second membership", async () => {
    const { bot, replies, deps } = makeBot([{ chatId: 10, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));
    await bot.handleUpdate(commandUpdate("join", 10, 1));

    expect(deps.membershipRepo.rows).toHaveLength(1);
    expect(replies[1]?.text).toMatch(/already/i);
  });

  it("refuses to join a chat with no registered team", async () => {
    const { bot, replies } = makeBot();
    await bot.handleUpdate(commandUpdate("join", 999, 5));

    expect(replies[0]?.text).toMatch(/\/setup/);
  });
});

describe("registerCommands — /datachannel (team-registration spec)", () => {
  it("an admin binds the data channel when run inside a topic", async () => {
    const { bot, replies, deps } = makeBot([{ chatId: 10, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));
    await bot.handleUpdate(commandUpdate("datachannel", 10, 1, { threadId: 77 }));

    expect(deps.teamRepo.rows[0]?.dataTopicThreadId).toBe(77);
    expect(replies[1]?.text).toMatch(/data channel/i);
  });

  it("refuses when run outside a topic (general chat)", async () => {
    const { bot, replies, deps } = makeBot([{ chatId: 10, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));
    await bot.handleUpdate(commandUpdate("datachannel", 10, 1));

    expect(deps.teamRepo.rows[0]?.dataTopicThreadId).toBeNull();
    expect(replies[1]?.text).toMatch(/topic/i);
  });

  it("refuses a non-admin member", async () => {
    const { bot, replies, deps } = makeBot([{ chatId: 10, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));
    await bot.handleUpdate(commandUpdate("join", 10, 3));
    await bot.handleUpdate(commandUpdate("datachannel", 10, 3, { threadId: 88 }));

    expect(deps.teamRepo.rows[0]?.dataTopicThreadId).toBeNull();
    expect(replies[2]?.text).toMatch(/admin/i);
  });

  // FIX-001: bindDataChannel also throws NotFoundError (actor membership
  // gone, or team gone) — a real TOCTOU window after resolveGroupMembership
  // resolved successfully. Simulated here by making the membershipRepo's
  // `get` (used only inside bindDataChannel) report the actor membership as
  // gone, while `getByMember` (used by resolveGroupMembership) still
  // resolves it — same deps object, so both calls see the same repo.
  it("refuses (200 + reply) instead of 500 when bindDataChannel's own re-check finds the actor membership gone (TOCTOU)", async () => {
    const { bot, replies, deps } = makeBot([{ chatId: 10, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));
    deps.membershipRepo.get = async () => null;

    await bot.handleUpdate(commandUpdate("datachannel", 10, 1, { threadId: 77 }));

    expect(replies[1]?.text).not.toMatch(/error/i);
    expect(replies[1]?.text?.length ?? 0).toBeGreaterThan(0);
  });
});
