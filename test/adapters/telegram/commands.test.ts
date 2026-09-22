import { Bot } from "grammy";
import type { CallbackQuery, Update } from "grammy/types";
import { describe, expect, it, vi } from "vitest";
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
  opts: { threadId?: number; chatType?: "private" | "supergroup"; args?: string } = {},
): Update {
  const commandText = `/${command}`;
  const text = `${commandText}${opts.args ? ` ${opts.args}` : ""}`;
  return {
    update_id: nextUpdateId++,
    message: {
      message_id: nextUpdateId,
      date: 0,
      chat: { id: chatId, type: opts.chatType ?? "supergroup", title: "Test group" } as never,
      from: { id: userId, is_bot: false, first_name: "User" },
      text,
      entities: [{ offset: 0, length: commandText.length, type: "bot_command" }],
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

function callbackUpdate(chatId: number, userId: number, data: string): Update {
  return {
    update_id: nextUpdateId++,
    callback_query: {
      id: `callback-${nextUpdateId}`,
      from: { id: userId, is_bot: false, first_name: "User" },
      chat_instance: "test-chat-instance",
      data,
      message: {
        message_id: nextUpdateId,
        date: 0,
        chat: { id: chatId, type: "private" },
      },
    } as CallbackQuery,
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

describe("registerCommands — DM team selection (team-membership spec)", () => {
  it("refuses a forged team callback and does not persist it", async () => {
    const { bot, replies, deps } = makeBot();
    await bot.handleUpdate(callbackUpdate(50, 7, "sel:00000000-0000-0000-0000-000000000099"));

    expect(deps.dmSelectionRepo.rows).toHaveLength(0);
    expect(replies[0]?.text).toMatch(/member/i);
  });

  it("stores a valid explicit selection after re-checking membership", async () => {
    const { bot, deps } = makeBot([{ chatId: 10, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));
    const teamId = deps.teamRepo.rows[0]!.id;

    await bot.handleUpdate(callbackUpdate(50, 1, `sel:${teamId}`));

    expect(deps.dmSelectionRepo.rows).toMatchObject([{ telegramUserId: 1, teamId }]);
  });

  it("rethrows an unexpected selection persistence failure to the webhook boundary", async () => {
    const { bot, deps } = makeBot([{ chatId: 10, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));
    const teamId = deps.teamRepo.rows[0]!.id;
    const failure = new Error("D1 unavailable");
    deps.dmSelectionRepo.set = async () => {
      throw failure;
    };

    await expect(bot.handleUpdate(callbackUpdate(50, 1, `sel:${teamId}`))).rejects.toMatchObject({ error: failure });
  });
});

describe("registerCommands — /profile data-channel gating", () => {
  it("refuses a group profile read outside the bound data topic", async () => {
    const { bot, replies, deps } = makeBot([{ chatId: 10, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));
    await bot.handleUpdate(commandUpdate("datachannel", 10, 1, { threadId: 77 }));
    await bot.handleUpdate(commandUpdate("profile", 10, 1, { args: "show" }));

    expect(replies[2]?.text).toMatch(/data channel/i);
    expect(deps.profileRepo.rows).toHaveLength(0);
  });

  it("writes and reads a profile in the bound topic and reports the team in DM", async () => {
    const { bot, replies, deps } = makeBot([{ chatId: 10, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));
    await bot.handleUpdate(commandUpdate("datachannel", 10, 1, { threadId: 77 }));
    await bot.handleUpdate(commandUpdate("profile", 10, 1, { threadId: 77, args: "set github_username octocat" }));
    await bot.handleUpdate(commandUpdate("profile", 10, 1, { threadId: 77, args: "show" }));
    await bot.handleUpdate(commandUpdate("profile", 50, 1, { chatType: "private", args: "show" }));

    expect(replies[3]?.text).toContain("github_username: octocat");
    expect(replies[4]?.text).toContain(`Team ${deps.teamRepo.rows[0]!.id}`);
  });
});

describe("registerCommands — role commands", () => {
  it("allows an admin to promote and demote a same-team member", async () => {
    const { bot, replies, deps } = makeBot([{ chatId: 10, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));
    await bot.handleUpdate(commandUpdate("join", 10, 2));
    const targetId = deps.membershipRepo.rows.find((row) => row.memberId !== deps.membershipRepo.rows[0]!.memberId)!.id;

    await bot.handleUpdate(commandUpdate("promote", 10, 1, { args: targetId }));
    expect(deps.membershipRepo.rows.find((row) => row.id === targetId)?.role).toBe("admin");
    await bot.handleUpdate(commandUpdate("demote", 10, 1, { args: targetId }));

    expect(deps.membershipRepo.rows.find((row) => row.id === targetId)?.role).toBe("member");
    expect(replies[3]?.text).toMatch(/member/);
  });
});

// R1-001 (product decision: SHARED DIRECTORY) — any registered member of the
// same team may read the whole team directory (member-profiles spec,
// pii-protection spec "Authorized read decrypts value").
describe("registerCommands — /profile show team directory (R1-001)", () => {
  it("returns the whole team directory grouped by member, each block showing owner identity and role", async () => {
    const { bot, replies, deps } = makeBot([{ chatId: 10, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));
    await bot.handleUpdate(commandUpdate("join", 10, 2));
    await bot.handleUpdate(commandUpdate("datachannel", 10, 1, { threadId: 77 }));
    const adminMembershipId = deps.membershipRepo.rows.find((m) => m.memberId === deps.memberRepo.rows.find((mm) => mm.telegramUserId === 1)!.id)!.id;
    const memberMembershipId = deps.membershipRepo.rows.find((m) => m.memberId === deps.memberRepo.rows.find((mm) => mm.telegramUserId === 2)!.id)!.id;
    await bot.handleUpdate(commandUpdate("profile", 10, 1, { threadId: 77, args: "set github_username octocat" }));

    await bot.handleUpdate(commandUpdate("profile", 10, 1, { threadId: 77, args: "show" }));

    const text = replies.at(-1)!.text;
    expect(text).toContain(`Team ${deps.teamRepo.rows[0]!.id}`);
    expect(text).toContain(`Member ${adminMembershipId}`);
    expect(text).toContain("role: admin");
    expect(text).toContain(`Member ${memberMembershipId}`);
    expect(text).toContain("role: member");
    expect(text).toContain("github_username: octocat");
  });

  it("returns only the requested member's block when a membership id is given", async () => {
    const { bot, replies, deps } = makeBot([{ chatId: 10, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));
    await bot.handleUpdate(commandUpdate("join", 10, 2));
    await bot.handleUpdate(commandUpdate("datachannel", 10, 1, { threadId: 77 }));
    const adminMembershipId = deps.membershipRepo.rows.find((m) => m.memberId === deps.memberRepo.rows.find((mm) => mm.telegramUserId === 1)!.id)!.id;
    const memberMembershipId = deps.membershipRepo.rows.find((m) => m.memberId === deps.memberRepo.rows.find((mm) => mm.telegramUserId === 2)!.id)!.id;

    await bot.handleUpdate(commandUpdate("profile", 10, 1, { threadId: 77, args: `show ${memberMembershipId}` }));

    const text = replies.at(-1)!.text;
    expect(text).toContain(`Member ${memberMembershipId}`);
    expect(text).not.toContain(`Member ${adminMembershipId}`);
  });

  it("renders unreadable for a profile field that failed decryption", async () => {
    const { bot, replies, deps } = makeBot([{ chatId: 10, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));
    await bot.handleUpdate(commandUpdate("datachannel", 10, 1, { threadId: 77 }));
    const teamId = deps.teamRepo.rows[0]!.id;
    const membershipId = deps.membershipRepo.rows[0]!.id;
    deps.profileRepo.rows.push({
      teamId,
      membershipId,
      field: "full_name",
      value: "",
      keyVersion: 1,
      updatedAt: 0,
      unreadable: true,
    });

    await bot.handleUpdate(commandUpdate("profile", 10, 1, { threadId: 77, args: "show" }));

    expect(replies.at(-1)!.text).toContain("full_name: unreadable");
  });
});

// R3-002/R4-002 — resolveCommandTeam's group branch used to return null
// silently when the chat has no registered team, and its D1 reads ran
// outside any logged boundary.
describe("registerCommands — no team registered for the chat (R3-002/R4-002)", () => {
  it("/profile replies and logs a refusal when the chat has no registered team", async () => {
    const { bot, replies, deps } = makeBot();
    const logSpy = vi.spyOn(deps.logger, "log");

    await bot.handleUpdate(commandUpdate("profile", 999, 5, { args: "show" }));

    expect(replies[0]?.text).toBe("No team is registered for this chat. Ask an admin to run /setup.");
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ event: "profile-team-resolution", outcome: "refused" }),
    );
  });

  it("/promote replies and logs a refusal when the chat has no registered team", async () => {
    const { bot, replies, deps } = makeBot();
    const logSpy = vi.spyOn(deps.logger, "log");

    await bot.handleUpdate(commandUpdate("promote", 999, 5, { args: "some-id" }));

    expect(replies[0]?.text).toBe("No team is registered for this chat. Ask an admin to run /setup.");
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ event: "promote-team-resolution", outcome: "refused" }),
    );
  });

  it("/demote replies and logs a refusal when the chat has no registered team", async () => {
    const { bot, replies, deps } = makeBot();
    const logSpy = vi.spyOn(deps.logger, "log");

    await bot.handleUpdate(commandUpdate("demote", 999, 5, { args: "some-id" }));

    expect(replies[0]?.text).toBe("No team is registered for this chat. Ask an admin to run /setup.");
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ event: "demote-team-resolution", outcome: "refused" }),
    );
  });

  it("logs and rethrows an unexpected D1 failure during /profile team resolution", async () => {
    const { bot, deps } = makeBot([{ chatId: 10, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));
    const logSpy = vi.spyOn(deps.logger, "log");
    const failure = new Error("D1 unavailable");
    deps.teamRepo.findByChatId = async () => {
      throw failure;
    };

    await expect(
      bot.handleUpdate(commandUpdate("profile", 10, 1, { args: "show" })),
    ).rejects.toMatchObject({ error: failure });

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ event: "profile-team-resolution", outcome: "error", errorCode: "Error" }),
    );
  });
});

// R3-001 — command-level coverage of the DM team picker for /profile,
// /promote and /demote (team-membership spec:62-78).
describe("registerCommands — DM team picker for /profile, /promote, /demote (R3-001)", () => {
  it("shows the team picker for /profile show when the caller has two or more memberships", async () => {
    const { bot, replies, deps } = makeBot([{ chatId: 10, userId: 1 }, { chatId: 20, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));
    await bot.handleUpdate(commandUpdate("setup", 20, 1));

    await bot.handleUpdate(commandUpdate("profile", 50, 1, { chatType: "private", args: "show" }));

    expect(replies.at(-1)?.text).toMatch(/choose which team/i);
  });

  it("shows the team picker for /promote when the caller has two or more memberships", async () => {
    const { bot, replies, deps } = makeBot([{ chatId: 10, userId: 1 }, { chatId: 20, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));
    await bot.handleUpdate(commandUpdate("setup", 20, 1));

    await bot.handleUpdate(commandUpdate("promote", 50, 1, { chatType: "private", args: "some-id" }));

    expect(replies.at(-1)?.text).toMatch(/choose which team/i);
  });

  it("shows the team picker for /demote when the caller has two or more memberships", async () => {
    const { bot, replies, deps } = makeBot([{ chatId: 10, userId: 1 }, { chatId: 20, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));
    await bot.handleUpdate(commandUpdate("setup", 20, 1));

    await bot.handleUpdate(commandUpdate("demote", 50, 1, { chatType: "private", args: "some-id" }));

    expect(replies.at(-1)?.text).toMatch(/choose which team/i);
  });

  it("uses a remembered DM selection within 15 minutes without prompting", async () => {
    const { bot, replies, deps } = makeBot([{ chatId: 10, userId: 1 }, { chatId: 20, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));
    await bot.handleUpdate(commandUpdate("setup", 20, 1));
    const teamId = deps.teamRepo.rows[0]!.id;
    await bot.handleUpdate(callbackUpdate(50, 1, `sel:${teamId}`));

    await bot.handleUpdate(commandUpdate("profile", 50, 1, { chatType: "private", args: "show" }));

    expect(replies.at(-1)?.text).toContain(`Team ${teamId}`);
  });

  it("re-triggers the picker once the remembered selection is older than 15 minutes", async () => {
    const { bot, replies, deps } = makeBot([{ chatId: 10, userId: 1 }, { chatId: 20, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));
    await bot.handleUpdate(commandUpdate("setup", 20, 1));
    const teamId = deps.teamRepo.rows[0]!.id;
    await bot.handleUpdate(callbackUpdate(50, 1, `sel:${teamId}`));
    deps.clock.advance(16 * 60 * 1000);

    await bot.handleUpdate(commandUpdate("profile", 50, 1, { chatType: "private", args: "show" }));

    expect(replies.at(-1)?.text).toMatch(/choose which team/i);
  });

  it("re-triggers the picker when the remembered team membership was lost (caller still has 2+ other teams)", async () => {
    // Three teams so losing the selected one still leaves 2+ memberships —
    // otherwise the caller would fall into the unrelated "exactly one
    // team" auto-resolve case instead of "needs-selection" again.
    const { bot, replies, deps } = makeBot([
      { chatId: 10, userId: 1 },
      { chatId: 20, userId: 1 },
      { chatId: 30, userId: 1 },
    ]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));
    await bot.handleUpdate(commandUpdate("setup", 20, 1));
    await bot.handleUpdate(commandUpdate("setup", 30, 1));
    const teamId = deps.teamRepo.rows[0]!.id;
    await bot.handleUpdate(callbackUpdate(50, 1, `sel:${teamId}`));
    const idx = deps.membershipRepo.rows.findIndex((m) => m.teamId === teamId);
    deps.membershipRepo.rows.splice(idx, 1);

    await bot.handleUpdate(commandUpdate("profile", 50, 1, { chatType: "private", args: "show" }));

    expect(replies.at(-1)?.text).toMatch(/choose which team/i);
  });
});

// R4-001/R4-003 — outbound Telegram calls after a successfully persisted DM
// team selection must not rethrow forever.
describe("registerCommands — DM team picker outbound failures (R4-001/R4-003)", () => {
  it("does not rethrow when answerCallbackQuery fails after a successful selection (replayed/expired callback)", async () => {
    const { bot, deps } = makeBot([{ chatId: 10, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));
    const teamId = deps.teamRepo.rows[0]!.id;
    const logSpy = vi.spyOn(deps.logger, "log");
    bot.api.config.use((_prev, method) => {
      if (method === "answerCallbackQuery") {
        return Promise.resolve({
          ok: false,
          error_code: 400,
          description: "Bad Request: query is too old and response timeout expired",
        } as never);
      }
      return Promise.resolve({ ok: true, result: {} } as never);
    });

    await bot.handleUpdate(callbackUpdate(50, 1, `sel:${teamId}`));

    expect(deps.dmSelectionRepo.rows).toMatchObject([{ telegramUserId: 1, teamId }]);
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ event: "dm-team-selection", outcome: "error" }),
    );
  });

  it("does not rethrow when reply fails after a successful selection", async () => {
    const { bot, deps } = makeBot([{ chatId: 10, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));
    const teamId = deps.teamRepo.rows[0]!.id;
    const logSpy = vi.spyOn(deps.logger, "log");
    bot.api.config.use((_prev, method) => {
      if (method === "sendMessage") {
        return Promise.resolve({
          ok: false,
          error_code: 403,
          description: "Forbidden: bot was blocked by the user",
        } as never);
      }
      return Promise.resolve({ ok: true, result: {} } as never);
    });

    await bot.handleUpdate(callbackUpdate(50, 1, `sel:${teamId}`));

    expect(deps.dmSelectionRepo.rows).toMatchObject([{ telegramUserId: 1, teamId }]);
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ event: "dm-team-selection", outcome: "error" }),
    );
  });
});
