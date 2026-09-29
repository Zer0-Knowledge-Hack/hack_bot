import { Bot } from "grammy";
import type { CallbackQuery, Update } from "grammy/types";
import { describe, expect, it, vi } from "vitest";
import { registerCommands } from "../../../src/adapters/telegram/commands";
import type { HackathonAnalysis } from "../../../src/domain/entities";
import type { TeamId } from "../../../src/domain/ids";
import { createSafeLogger } from "../../../src/adapters/log/safe-logger";
import {
  fakeAnalysisJobQueue,
  fakeAnalysisJobRepo,
  fakeAnalysisQuota,
  fakeChatAdminChecker,
  fakeChatPublisher,
  fakeClock,
  fakeDmSelectionRepo,
  fakeGithubOrgClaimRepo,
  fakeHackathonAnalysisRepo,
  fakeIdGen,
  fakeMemberRepo,
  fakeMembershipRepo,
  fakeProfileRepo,
  fakeRepoTopicLinkRepo,
  fakeTeamRepo,
} from "../../fakes";

// Same technique as test/runtime-assumptions/grammy-api-stub.test.ts: a
// real grammY `Bot`, outbound Telegram API calls intercepted with a
// transformer instead of hitting the network (mandatory point 7). This
// exercises the actual production `registerCommands` wiring end-to-end —
// only the network boundary is stubbed.
interface HackathonFakeOptions {
  quota?: "ok" | "busy" | "cap-reached";
  queueThrows?: boolean;
}

function makeBot(
  admins: Array<{ chatId: number; userId: number }> = [],
  hackathon: HackathonFakeOptions = {},
) {
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
  // Every raw sendMessage payload, so plain-text (no parse_mode) can be
  // asserted on the wire.
  const payloads: Array<Record<string, unknown>> = [];
  // Text of every answerCallbackQuery alert shown to the user.
  const alerts: string[] = [];
  bot.api.config.use((_prev, method, payload) => {
    if (method === "answerCallbackQuery") {
      const text = (payload as { text?: string }).text;
      if (text !== undefined) alerts.push(text);
    }
    if (method === "sendMessage") {
      const p = payload as { chat_id: number; text: string };
      payloads.push(payload as Record<string, unknown>);
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
  const githubOrgClaimRepo = fakeGithubOrgClaimRepo();
  const repoTopicLinkRepo = fakeRepoTopicLinkRepo();
  const hackathonAnalysisRepo = fakeHackathonAnalysisRepo();
  const analysisQuota = fakeAnalysisQuota({ result: hackathon.quota ?? "ok" });
  const analysisJobQueue = fakeAnalysisJobQueue({ throws: hackathon.queueThrows ?? false });
  const analysisJobRepo = fakeAnalysisJobRepo();
  const chatPublisher = fakeChatPublisher();
  const deps = {
    teamRepo,
    memberRepo,
    membershipRepo,
    profileRepo,
    dmSelectionRepo,
    chatAdminChecker,
    githubOrgClaimRepo,
    repoTopicLinkRepo,
    hackathonAnalysisRepo,
    analysisQuota,
    analysisJobQueue,
    analysisJobRepo,
    chatPublisher,
    clock: fakeClock(),
    idGen: fakeIdGen(),
    logger: createSafeLogger(),
  };
  registerCommands(bot, deps);
  return { bot, replies, payloads, alerts, deps };
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
    expect(replies[0]?.text).toBe("Equipo creado. Eres el primer administrador.");
  });

  it("refuses when a team already exists for the chat", async () => {
    const { bot, replies } = makeBot([{ chatId: 10, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));
    await bot.handleUpdate(commandUpdate("setup", 10, 1));

    expect(replies[1]?.text).toBe("Ya hay un equipo registrado en este chat.");
  });

  it("refuses when the caller is not a verified group admin", async () => {
    const { bot, replies, deps } = makeBot([]); // no admins configured
    await bot.handleUpdate(commandUpdate("setup", 20, 2));

    expect(deps.teamRepo.rows).toHaveLength(0);
    expect(replies[0]?.text).toBe("Solo un administrador del grupo de Telegram puede ejecutar /setup.");
  });

  it("tells the caller to run /setup inside the group when run in a private chat (DM)", async () => {
    const { bot, replies, deps } = makeBot([{ chatId: 30, userId: 30 }]);
    const adminCheck = vi.spyOn(deps.chatAdminChecker, "isAdmin");
    const logSpy = vi.spyOn(deps.logger, "log");

    await bot.handleUpdate(commandUpdate("setup", 30, 30, { chatType: "private" }));

    expect(deps.teamRepo.rows).toHaveLength(0);
    expect(adminCheck).not.toHaveBeenCalled();
    expect(replies[0]?.text).toBe(
      "Ejecuta /setup dentro del grupo que quieres registrar como equipo, no en un chat privado.",
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ event: "setup-team", outcome: "refused", errorCode: "PrivateChat" }),
    );
  });

  it("tells an anonymous group admin to turn off anonymity instead of refusing as a non-admin", async () => {
    // Telegram delivers an anonymous admin's message with `from` set to
    // the GroupAnonymousBot and `sender_chat` set to the group itself.
    const { bot, replies, deps } = makeBot();
    const adminCheck = vi.spyOn(deps.chatAdminChecker, "isAdmin");
    const logSpy = vi.spyOn(deps.logger, "log");
    const base = commandUpdate("setup", -100_40, 1_087_968_824);
    const update = {
      ...base,
      message: { ...base.message, sender_chat: { id: -100_40, type: "supergroup", title: "Test group" } },
    } as Update;

    await bot.handleUpdate(update);

    expect(deps.teamRepo.rows).toHaveLength(0);
    expect(adminCheck).not.toHaveBeenCalled();
    expect(replies[0]?.text).toBe(
      'Estás publicando como administrador anónimo, así que no se puede verificar tu condición de administrador. Desactiva "Permanecer anónimo" en tus permisos de administrador y vuelve a ejecutar /setup.',
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ event: "setup-team", outcome: "refused", errorCode: "AnonymousAdmin" }),
    );
  });
});

describe("registerCommands — /join (team-membership spec)", () => {
  it("creates a membership for a new user", async () => {
    const { bot, replies, deps } = makeBot([{ chatId: 10, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));
    await bot.handleUpdate(commandUpdate("join", 10, 3));

    expect(deps.membershipRepo.rows).toHaveLength(2);
    expect(replies[1]?.text).toBe("Te uniste al equipo.");
  });

  it("refuses a duplicate join without creating a second membership", async () => {
    const { bot, replies, deps } = makeBot([{ chatId: 10, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));
    await bot.handleUpdate(commandUpdate("join", 10, 1));

    expect(deps.membershipRepo.rows).toHaveLength(1);
    expect(replies[1]?.text).toBe("Ya eres miembro de este equipo.");
  });

  it("refuses to join a chat with no registered team", async () => {
    const { bot, replies } = makeBot();
    await bot.handleUpdate(commandUpdate("join", 999, 5));

    expect(replies[0]?.text).toBe(
      "No hay ningún equipo registrado en este chat. Pide a un administrador que ejecute /setup.",
    );
  });
});

describe("registerCommands — /datachannel (team-registration spec)", () => {
  it("an admin binds the data channel when run inside a topic", async () => {
    const { bot, replies, deps } = makeBot([{ chatId: 10, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));
    await bot.handleUpdate(commandUpdate("datachannel", 10, 1, { threadId: 77 }));

    expect(deps.teamRepo.rows[0]?.dataTopicThreadId).toBe(77);
    expect(replies[1]?.text).toBe("Este tema es ahora el canal de datos del equipo.");
  });

  it("refuses when run outside a topic (general chat)", async () => {
    const { bot, replies, deps } = makeBot([{ chatId: 10, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));
    await bot.handleUpdate(commandUpdate("datachannel", 10, 1));

    expect(deps.teamRepo.rows[0]?.dataTopicThreadId).toBeNull();
    expect(replies[1]?.text).toBe(
      "Ejecuta /datachannel dentro del tema que quieres usar como canal de datos del equipo.",
    );
  });

  it("refuses a non-admin member", async () => {
    const { bot, replies, deps } = makeBot([{ chatId: 10, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));
    await bot.handleUpdate(commandUpdate("join", 10, 3));
    await bot.handleUpdate(commandUpdate("datachannel", 10, 3, { threadId: 88 }));

    expect(deps.teamRepo.rows[0]?.dataTopicThreadId).toBeNull();
    expect(replies[2]?.text).toBe("Solo un administrador del equipo puede asignar el canal de datos.");
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

    expect(replies[1]?.text).toBe(
      "No se pudo verificar tu pertenencia al equipo. Vuelve a intentar /datachannel.",
    );
  });
});

describe("registerCommands — DM team selection (team-membership spec)", () => {
  it("refuses a forged team callback and does not persist it", async () => {
    const { bot, replies, alerts, deps } = makeBot();
    await bot.handleUpdate(callbackUpdate(50, 7, "sel:00000000-0000-0000-0000-000000000099"));

    expect(deps.dmSelectionRepo.rows).toHaveLength(0);
    expect(alerts).toEqual(["Ese equipo no está disponible para ti."]);
    expect(replies[0]?.text).toBe("No eres miembro de ese equipo.");
  });

  it("stores a valid explicit selection after re-checking membership", async () => {
    const { bot, replies, deps } = makeBot([{ chatId: 10, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));
    const teamId = deps.teamRepo.rows[0]!.id;

    await bot.handleUpdate(callbackUpdate(50, 1, `sel:${teamId}`));

    expect(deps.dmSelectionRepo.rows).toMatchObject([{ telegramUserId: 1, teamId }]);
    expect(replies.at(-1)?.text).toBe("Equipo seleccionado. Vuelve a ejecutar tu comando para continuar.");
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

  it.each([
    ["empty team id", "sel:"],
    ["path traversal", "sel:../team"],
    ["SQL-ish", "sel:1' OR '1'='1"],
    ["oversized team id", `sel:${"a".repeat(65)}`],
    ["unknown prefix", "pick:id-1"],
    ["no prefix", "id-1"],
    ["embedded newline", "sel:id-1\nsel:id-2"],
  ])("ignores malformed callback data (%s) without persisting or replying", async (_label, data) => {
    const { bot, replies, deps } = makeBot([{ chatId: 10, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));

    await expect(bot.handleUpdate(callbackUpdate(50, 1, data))).resolves.toBeUndefined();

    expect(deps.dmSelectionRepo.rows).toHaveLength(0);
    expect(replies).toHaveLength(1); // only the /setup reply
  });

  it("ignores a well-formed selection callback that arrives from a group chat", async () => {
    const { bot, replies, deps } = makeBot([{ chatId: 10, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));
    const teamId = deps.teamRepo.rows[0]!.id;
    const base = callbackUpdate(10, 1, `sel:${teamId}`);
    const update = {
      ...base,
      callback_query: {
        ...base.callback_query,
        message: { message_id: 1, date: 0, chat: { id: 10, type: "supergroup", title: "Test group" } },
      },
    } as Update;

    await bot.handleUpdate(update);

    expect(deps.dmSelectionRepo.rows).toHaveLength(0);
    expect(replies).toHaveLength(1);
  });
});

describe("registerCommands — /profile data-channel gating", () => {
  it("refuses a group profile read outside the bound data topic", async () => {
    const { bot, replies, deps } = makeBot([{ chatId: 10, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));
    await bot.handleUpdate(commandUpdate("datachannel", 10, 1, { threadId: 77 }));
    await bot.handleUpdate(commandUpdate("profile", 10, 1, { args: "show" }));

    expect(replies[2]?.text).toBe(
      "Los datos de los miembros solo están disponibles en el canal de datos del equipo.",
    );
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
    expect(replies[4]?.text).toContain(`Equipo ${deps.teamRepo.rows[0]!.id}`);
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
    expect(replies[2]?.text).toBe(`Rol del miembro cambiado a administrador para el equipo ${deps.teamRepo.rows[0]!.id}.`);
    await bot.handleUpdate(commandUpdate("demote", 10, 1, { args: targetId }));

    expect(deps.membershipRepo.rows.find((row) => row.id === targetId)?.role).toBe("member");
    expect(replies[3]?.text).toBe(`Rol del miembro cambiado a miembro para el equipo ${deps.teamRepo.rows[0]!.id}.`);
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
    expect(text).toContain(`Equipo ${deps.teamRepo.rows[0]!.id}`);
    expect(text).toContain(`Miembro ${adminMembershipId}`);
    expect(text).toContain("rol: administrador");
    expect(text).toContain(`Miembro ${memberMembershipId}`);
    expect(text).toContain("rol: miembro");
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
    expect(text).toContain(`Miembro ${memberMembershipId}`);
    expect(text).not.toContain(`Miembro ${adminMembershipId}`);
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

    expect(replies.at(-1)!.text).toContain("full_name: ilegible");
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

    expect(replies[0]?.text).toBe("No hay ningún equipo registrado en este chat. Pide a un administrador que ejecute /setup.");
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ event: "profile-team-resolution", outcome: "refused" }),
    );
  });

  it("/promote replies and logs a refusal when the chat has no registered team", async () => {
    const { bot, replies, deps } = makeBot();
    const logSpy = vi.spyOn(deps.logger, "log");

    await bot.handleUpdate(commandUpdate("promote", 999, 5, { args: "some-id" }));

    expect(replies[0]?.text).toBe("No hay ningún equipo registrado en este chat. Pide a un administrador que ejecute /setup.");
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ event: "promote-team-resolution", outcome: "refused" }),
    );
  });

  it("/demote replies and logs a refusal when the chat has no registered team", async () => {
    const { bot, replies, deps } = makeBot();
    const logSpy = vi.spyOn(deps.logger, "log");

    await bot.handleUpdate(commandUpdate("demote", 999, 5, { args: "some-id" }));

    expect(replies[0]?.text).toBe("No hay ningún equipo registrado en este chat. Pide a un administrador que ejecute /setup.");
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

    expect(replies.at(-1)?.text).toBe("Elige a qué equipo se aplica este comando.");
  });

  it("shows the team picker for /promote when the caller has two or more memberships", async () => {
    const { bot, replies, deps } = makeBot([{ chatId: 10, userId: 1 }, { chatId: 20, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));
    await bot.handleUpdate(commandUpdate("setup", 20, 1));

    await bot.handleUpdate(commandUpdate("promote", 50, 1, { chatType: "private", args: "some-id" }));

    expect(replies.at(-1)?.text).toBe("Elige a qué equipo se aplica este comando.");
  });

  it("shows the team picker for /demote when the caller has two or more memberships", async () => {
    const { bot, replies, deps } = makeBot([{ chatId: 10, userId: 1 }, { chatId: 20, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));
    await bot.handleUpdate(commandUpdate("setup", 20, 1));

    await bot.handleUpdate(commandUpdate("demote", 50, 1, { chatType: "private", args: "some-id" }));

    expect(replies.at(-1)?.text).toBe("Elige a qué equipo se aplica este comando.");
  });

  it("uses a remembered DM selection within 15 minutes without prompting", async () => {
    const { bot, replies, deps } = makeBot([{ chatId: 10, userId: 1 }, { chatId: 20, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));
    await bot.handleUpdate(commandUpdate("setup", 20, 1));
    const teamId = deps.teamRepo.rows[0]!.id;
    await bot.handleUpdate(callbackUpdate(50, 1, `sel:${teamId}`));

    await bot.handleUpdate(commandUpdate("profile", 50, 1, { chatType: "private", args: "show" }));

    expect(replies.at(-1)?.text).toContain(`Equipo ${teamId}`);
  });

  it("re-triggers the picker once the remembered selection is older than 15 minutes", async () => {
    const { bot, replies, deps } = makeBot([{ chatId: 10, userId: 1 }, { chatId: 20, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));
    await bot.handleUpdate(commandUpdate("setup", 20, 1));
    const teamId = deps.teamRepo.rows[0]!.id;
    await bot.handleUpdate(callbackUpdate(50, 1, `sel:${teamId}`));
    deps.clock.advance(16 * 60 * 1000);

    await bot.handleUpdate(commandUpdate("profile", 50, 1, { chatType: "private", args: "show" }));

    expect(replies.at(-1)?.text).toBe("Elige a qué equipo se aplica este comando.");
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

    expect(replies.at(-1)?.text).toBe("Elige a qué equipo se aplica este comando.");
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

// PR5 (repo-topic-links spec) — /linkrepo, /unlinkrepo, /repos.
describe("registerCommands — /linkrepo (repo-topic-links spec)", () => {
  it("an admin links a claimed-org repo when run inside a topic", async () => {
    const { bot, replies, deps } = makeBot([{ chatId: 10, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));
    deps.githubOrgClaimRepo.rows.push({ teamId: deps.teamRepo.rows[0]!.id, orgLogin: "owner" });

    await bot.handleUpdate(commandUpdate("linkrepo", 10, 1, { threadId: 77, args: "owner/repo" }));

    expect(deps.repoTopicLinkRepo.rows).toMatchObject([
      { repoFullName: "owner/repo", threadId: 77 },
    ]);
    expect(replies[1]?.text).toBe("Se vinculó owner/repo a este tema.");
  });

  it("accepts a pasted GitHub repo URL", async () => {
    const { bot, replies, deps } = makeBot([{ chatId: 10, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));
    deps.githubOrgClaimRepo.rows.push({ teamId: deps.teamRepo.rows[0]!.id, orgLogin: "owner" });

    await bot.handleUpdate(
      commandUpdate("linkrepo", 10, 1, { threadId: 77, args: "https://github.com/Owner/Repo" }),
    );

    expect(deps.repoTopicLinkRepo.rows).toMatchObject([
      { repoFullName: "owner/repo", threadId: 77 },
    ]);
    expect(replies[1]?.text).toBe("Se vinculó owner/repo a este tema.");
  });

  it("refuses an unclaimed org and stores no row", async () => {
    const { bot, replies, deps } = makeBot([{ chatId: 10, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));

    await bot.handleUpdate(commandUpdate("linkrepo", 10, 1, { threadId: 77, args: "owner/repo" }));

    expect(deps.repoTopicLinkRepo.rows).toHaveLength(0);
    expect(replies[1]?.text).toBe("La organización de este repositorio no está reclamada por tu equipo.");
  });

  it("refuses a non-admin member", async () => {
    const { bot, replies, deps } = makeBot([{ chatId: 10, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));
    await bot.handleUpdate(commandUpdate("join", 10, 3));
    deps.githubOrgClaimRepo.rows.push({ teamId: deps.teamRepo.rows[0]!.id, orgLogin: "owner" });

    await bot.handleUpdate(commandUpdate("linkrepo", 10, 3, { threadId: 77, args: "owner/repo" }));

    expect(deps.repoTopicLinkRepo.rows).toHaveLength(0);
    expect(replies[2]?.text).toBe("Solo un administrador del equipo puede vincular un repositorio.");
  });

  it("refuses when run outside a topic (general chat) and instructs the admin to run it inside the intended topic", async () => {
    const { bot, replies, deps } = makeBot([{ chatId: 10, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));
    deps.githubOrgClaimRepo.rows.push({ teamId: deps.teamRepo.rows[0]!.id, orgLogin: "owner" });

    await bot.handleUpdate(commandUpdate("linkrepo", 10, 1, { args: "owner/repo" }));

    expect(deps.repoTopicLinkRepo.rows).toHaveLength(0);
    expect(replies[1]?.text).toBe(
      "Ejecuta /linkrepo dentro del tema al que quieres vincular el repositorio.",
    );
  });

  it("refuses a malformed repo argument with a usage reply", async () => {
    const { bot, replies, deps } = makeBot([{ chatId: 10, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));

    await bot.handleUpdate(commandUpdate("linkrepo", 10, 1, { threadId: 77, args: "not-a-repo" }));

    expect(replies[1]?.text).toBe("Uso: /linkrepo <owner/repo o URL del repositorio de GitHub>");
  });

  it("re-linking an already-linked repo moves it and the reply names the previous topic", async () => {
    const { bot, replies, deps } = makeBot([{ chatId: 10, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));
    deps.githubOrgClaimRepo.rows.push({ teamId: deps.teamRepo.rows[0]!.id, orgLogin: "owner" });
    await bot.handleUpdate(commandUpdate("linkrepo", 10, 1, { threadId: 77, args: "owner/repo" }));

    await bot.handleUpdate(commandUpdate("linkrepo", 10, 1, { threadId: 88, args: "owner/repo" }));

    expect(deps.repoTopicLinkRepo.rows).toMatchObject([{ repoFullName: "owner/repo", threadId: 88 }]);
    // REL-001: pin the exact direction (previous topic -> new topic), not
    // just that both numbers appear somewhere in the reply.
    expect(replies[2]?.text).toBe(
      "Se movió owner/repo del tema 77 al tema 88. El tema 77 ya no recibirá alertas de este repositorio.",
    );
  });
});

describe("registerCommands — /unlinkrepo (repo-topic-links spec)", () => {
  it("an admin unlinks a repo when run inside a topic", async () => {
    const { bot, replies, deps } = makeBot([{ chatId: 10, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));
    deps.githubOrgClaimRepo.rows.push({ teamId: deps.teamRepo.rows[0]!.id, orgLogin: "owner" });
    await bot.handleUpdate(commandUpdate("linkrepo", 10, 1, { threadId: 77, args: "owner/repo" }));

    await bot.handleUpdate(commandUpdate("unlinkrepo", 10, 1, { threadId: 77, args: "owner/repo" }));

    expect(deps.repoTopicLinkRepo.rows).toHaveLength(0);
    expect(replies[2]?.text).toBe("Se desvinculó owner/repo de este tema.");
  });

  it("accepts a pasted GitHub repo URL", async () => {
    const { bot, replies, deps } = makeBot([{ chatId: 10, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));
    deps.githubOrgClaimRepo.rows.push({ teamId: deps.teamRepo.rows[0]!.id, orgLogin: "owner" });
    await bot.handleUpdate(commandUpdate("linkrepo", 10, 1, { threadId: 77, args: "owner/repo" }));

    await bot.handleUpdate(
      commandUpdate("unlinkrepo", 10, 1, { threadId: 77, args: "https://github.com/owner/repo/" }),
    );

    expect(deps.repoTopicLinkRepo.rows).toHaveLength(0);
    expect(replies[2]?.text).toBe("Se desvinculó owner/repo de este tema.");
  });

  it("refuses a non-admin member", async () => {
    const { bot, replies, deps } = makeBot([{ chatId: 10, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));
    await bot.handleUpdate(commandUpdate("join", 10, 3));
    deps.githubOrgClaimRepo.rows.push({ teamId: deps.teamRepo.rows[0]!.id, orgLogin: "owner" });
    await bot.handleUpdate(commandUpdate("linkrepo", 10, 1, { threadId: 77, args: "owner/repo" }));

    await bot.handleUpdate(commandUpdate("unlinkrepo", 10, 3, { threadId: 77, args: "owner/repo" }));

    expect(deps.repoTopicLinkRepo.rows).toHaveLength(1);
    expect(replies[3]?.text).toBe("Solo un administrador del equipo puede desvincular un repositorio.");
  });

  it("refuses when run outside a topic (general chat)", async () => {
    const { bot, replies, deps } = makeBot([{ chatId: 10, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));

    await bot.handleUpdate(commandUpdate("unlinkrepo", 10, 1, { args: "owner/repo" }));

    expect(replies[1]?.text).toBe(
      "Ejecuta /unlinkrepo dentro del tema del que quieres desvincular el repositorio.",
    );
  });
});

describe("registerCommands — /repos (repo-topic-links spec)", () => {
  it("a non-admin member lists the team's claimed-org links from the general chat", async () => {
    const { bot, replies, deps } = makeBot([{ chatId: 10, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));
    await bot.handleUpdate(commandUpdate("join", 10, 3));
    deps.githubOrgClaimRepo.rows.push({ teamId: deps.teamRepo.rows[0]!.id, orgLogin: "owner" });
    await bot.handleUpdate(commandUpdate("linkrepo", 10, 1, { threadId: 77, args: "owner/repo-a" }));
    await bot.handleUpdate(commandUpdate("linkrepo", 10, 1, { threadId: 78, args: "owner/repo-b" }));

    await bot.handleUpdate(commandUpdate("repos", 10, 3));

    expect(replies.at(-1)?.text).toContain("owner/repo-a");
    expect(replies.at(-1)?.text).toContain("owner/repo-b");
    expect(deps.repoTopicLinkRepo.rows).toHaveLength(2);
  });

  it("refuses a non-member", async () => {
    const { bot, replies, deps } = makeBot([{ chatId: 10, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));

    await bot.handleUpdate(commandUpdate("repos", 10, 999));

    expect(replies[1]?.text).toBe("No eres miembro de este equipo.");
  });

  it("excludes a link whose org claim was later removed", async () => {
    const { bot, replies, deps } = makeBot([{ chatId: 10, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));
    deps.githubOrgClaimRepo.rows.push({ teamId: deps.teamRepo.rows[0]!.id, orgLogin: "owner" });
    await bot.handleUpdate(commandUpdate("linkrepo", 10, 1, { threadId: 77, args: "owner/repo" }));
    deps.githubOrgClaimRepo.rows.length = 0;

    await bot.handleUpdate(commandUpdate("repos", 10, 1));

    expect(replies.at(-1)?.text).not.toContain("owner/repo");
  });

  // REL-002: pin the exact zero-links reply text.
  it("replies with the exact zero-links message when the team has no links", async () => {
    const { bot, replies, deps } = makeBot([{ chatId: 10, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));

    await bot.handleUpdate(commandUpdate("repos", 10, 1));

    expect(replies.at(-1)?.text).toBe("Todavía no hay repositorios vinculados.");
  });

  // RES-001: past Telegram's 4096-char limit, an unbounded reply would make
  // ctx.reply throw, runCommand would rethrow it as an unrecognized error
  // (it is not a domain error), and the route would answer 500 — which
  // Telegram retries forever, permanently breaking /repos for any team with
  // enough links. This team has 300 links, comfortably enough to exceed the
  // limit with the "owner/repo-N -> tema 1" line format.
  it("caps the reply below Telegram's 4096-char limit and ends with a fixed summary line", async () => {
    const { bot, replies, deps } = makeBot([{ chatId: 10, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));
    const teamId = deps.teamRepo.rows[0]!.id;
    deps.githubOrgClaimRepo.rows.push({ teamId, orgLogin: "owner" });
    const total = 300;
    for (let i = 0; i < total; i++) {
      deps.repoTopicLinkRepo.rows.push({
        teamId,
        repoFullName: `owner/repo-${i}` as never,
        orgLogin: "owner",
        threadId: 1,
        createdAt: 0,
        updatedAt: 0,
      });
    }

    await bot.handleUpdate(commandUpdate("repos", 10, 1));

    const text = replies.at(-1)!.text;
    expect(text.length).toBeLessThanOrEqual(4096);
    const includedLines = text.split("\n").filter((line) => line.startsWith("owner/repo-")).length;
    expect(text.endsWith(`…y ${total - includedLines} más`)).toBe(true);
    expect(text).toMatch(/…y \d+ más$/);
    expect(includedLines).toBeLessThan(total);
    expect(includedLines).toBeGreaterThan(0);
  });
});

// PR10 (hackathon-analysis spec) — /hackathon, /hackathons.
const TEAM_ADMIN = { chatId: 10, userId: 1 };

// A team in chat 10 with user 1 as its admin and user 3 as a plain member.
async function hackathonTeam(hackathon: HackathonFakeOptions = {}) {
  const ctx = makeBot([TEAM_ADMIN], hackathon);
  await ctx.bot.handleUpdate(commandUpdate("setup", 10, 1));
  await ctx.bot.handleUpdate(commandUpdate("join", 10, 3));
  const teamId = ctx.deps.teamRepo.rows[0]!.id;
  const baseReplies = ctx.replies.length;
  return { ...ctx, teamId, baseReplies };
}

function storedAnalysis(
  teamId: TeamId,
  slug: string,
  overrides: Partial<HackathonAnalysis> = {},
): HackathonAnalysis {
  return {
    id: `analysis-${slug}`,
    teamId,
    slug,
    sourceUrl: `https://example.com/${slug}`,
    normalizedUrl: `https://example.com/${slug}`,
    fields: {
      name: { value: `Hack ${slug}`, snippet: "", confidence: 0.9 },
      format: null,
      location: null,
      teamSize: null,
      submissionDeadline: { value: "2026-11-01", snippet: "", confidence: 0.9 },
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
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("registerCommands — /hackathon <url> (hackathon-analysis spec: Admin-Only Fresh Analysis)", () => {
  it("an admin in the general chat gets an immediate ack and a queued job", async () => {
    const { bot, replies, baseReplies, deps, teamId } = await hackathonTeam();

    await bot.handleUpdate(commandUpdate("hackathon", 10, 1, { args: "https://example.com/event" }));

    expect(replies).toHaveLength(baseReplies + 1);
    expect(replies.at(-1)?.text).toBe("Analizando example.com… el resultado se publicará aquí.");
    expect(deps.analysisQuota.reserved).toHaveLength(1);
    expect(deps.analysisJobQueue.sent).toMatchObject([
      { v: 1, teamId, chatId: 10, threadId: null, fetchUrl: "https://example.com/event" },
    ]);
  });

  it("carries the topic id into the job when run inside a topic", async () => {
    const { bot, deps } = await hackathonTeam();

    await bot.handleUpdate(
      commandUpdate("hackathon", 10, 1, { threadId: 77, args: "https://example.com/event" }),
    );

    expect(deps.analysisJobQueue.sent).toMatchObject([{ chatId: 10, threadId: 77 }]);
  });

  it("refuses a non-admin member without reserving a slot or enqueuing", async () => {
    const { bot, replies, deps } = await hackathonTeam();

    await bot.handleUpdate(commandUpdate("hackathon", 10, 3, { args: "https://example.com/event" }));

    expect(replies.at(-1)?.text).toBe(
      "Solo un administrador del equipo puede analizar o vincular un hackathon.",
    );
    expect(deps.analysisQuota.reserved).toHaveLength(0);
    expect(deps.analysisJobQueue.sent).toHaveLength(0);
  });

  it("refuses a caller who is not a team member", async () => {
    const { bot, replies, deps } = await hackathonTeam();

    await bot.handleUpdate(commandUpdate("hackathon", 10, 999, { args: "https://example.com/event" }));

    expect(replies.at(-1)?.text).toBe("No eres miembro de este equipo.");
    expect(deps.analysisJobQueue.sent).toHaveLength(0);
  });

  it.each([
    ["a loopback IP literal", "http://127.0.0.1/admin", "ip-literal"],
    ["a non-http scheme", "ftp://example.com/event", "scheme"],
    ["a private suffix", "https://wiki.internal/event", "private-suffix"],
  ])("refuses %s at the producer and logs only a fixed reason", async (_label, url, reason) => {
    const { bot, replies, deps } = await hackathonTeam();
    const logSpy = vi.spyOn(deps.logger, "log");

    await bot.handleUpdate(commandUpdate("hackathon", 10, 1, { args: url }));

    expect(replies.at(-1)?.text).toBe("Solo se pueden analizar páginas públicas http(s).");
    expect(deps.analysisQuota.reserved).toHaveLength(0);
    expect(deps.analysisJobQueue.sent).toHaveLength(0);
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "refused", errorCode: "UnsafeUrlError", reason: `unsafe-url:${reason}` }),
    );
    expect(JSON.stringify(logSpy.mock.calls)).not.toContain(url);
  });

  it("refuses a URL longer than the job row allows without reserving a slot", async () => {
    const { bot, replies, deps } = await hackathonTeam();

    await bot.handleUpdate(
      commandUpdate("hackathon", 10, 1, { args: `https://example.com/${"a".repeat(2100)}` }),
    );

    expect(replies.at(-1)?.text).toBe("Esa URL es demasiado larga (máximo 2048 caracteres).");
    expect(deps.analysisQuota.reserved).toHaveLength(0);
  });

  it.each([
    ["busy", "Ya hay un análisis en curso para este equipo. Espera su resultado."],
    [
      "cap-reached",
      "Límite diario alcanzado (5 análisis nuevos por día UTC). Volver a mostrar un slug no cuenta.",
    ],
  ] as const)("replies with a clear refusal when the quota says %s and enqueues nothing", async (quota, expected) => {
    const { bot, replies, deps } = await hackathonTeam({ quota });

    await bot.handleUpdate(commandUpdate("hackathon", 10, 1, { args: "https://example.com/event" }));

    expect(replies.at(-1)?.text).toBe(expected);
    expect(deps.analysisJobQueue.sent).toHaveLength(0);
  });

  it("replies 'no se pudo iniciar' and refunds the slot when enqueuing fails", async () => {
    const { bot, replies, deps } = await hackathonTeam({ queueThrows: true });
    const logSpy = vi.spyOn(deps.logger, "log");

    await bot.handleUpdate(commandUpdate("hackathon", 10, 1, { args: "https://example.com/event" }));

    expect(replies.at(-1)?.text).toBe(
      "No se pudo iniciar el análisis; inténtalo de nuevo en un minuto. No se contó en el límite diario.",
    );
    expect(deps.analysisQuota.released).toMatchObject([{ refund: true }]);
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "QueueSendFailedError", reason: "queue:send-failed" }),
    );
  });

  it("logs no line containing the URL or its host", async () => {
    const { bot, deps } = await hackathonTeam();
    const logSpy = vi.spyOn(deps.logger, "log");

    await bot.handleUpdate(
      commandUpdate("hackathon", 10, 1, { args: "https://secret-event.example.org/apply?token=abc" }),
    );

    expect(logSpy).toHaveBeenCalled();
    const logged = JSON.stringify(logSpy.mock.calls);
    expect(logged).not.toContain("secret-event");
    expect(logged).not.toContain("token=abc");
  });
});

describe("registerCommands — /hackathon <slug> (hackathon-analysis spec: Re-Show, One Analysis Per Topic)", () => {
  it("any member re-shows a stored analysis in the general chat, free of cap and without posting or linking", async () => {
    const { bot, replies, deps, teamId } = await hackathonTeam();
    deps.hackathonAnalysisRepo.rows.push(storedAnalysis(teamId, "meridian"));

    await bot.handleUpdate(commandUpdate("hackathon", 10, 3, { args: "meridian" }));

    expect(replies.at(-1)?.text).toContain("Slug: meridian");
    expect(replies.at(-1)?.text).toContain("Hack meridian");
    expect(deps.analysisQuota.reserved).toHaveLength(0);
    expect(deps.analysisJobQueue.sent).toHaveLength(0);
    expect(deps.chatPublisher.posted).toHaveLength(0);
    expect(deps.hackathonAnalysisRepo.rows[0]?.threadId).toBeNull();
  });

  it("replies that no analysis exists for an unknown slug", async () => {
    const { bot, replies } = await hackathonTeam();

    await bot.handleUpdate(commandUpdate("hackathon", 10, 3, { args: "nope" }));

    expect(replies.at(-1)?.text).toBe("No hay ningún análisis con ese slug. Consulta /hackathons.");
  });

  it("an admin in a topic links and pins the analysis and acknowledges", async () => {
    const { bot, replies, deps, teamId } = await hackathonTeam();
    deps.hackathonAnalysisRepo.rows.push(storedAnalysis(teamId, "meridian"));

    await bot.handleUpdate(commandUpdate("hackathon", 10, 1, { threadId: 77, args: "meridian" }));

    expect(deps.chatPublisher.posted).toMatchObject([{ chatId: 10, threadId: 77 }]);
    expect(deps.chatPublisher.posted[0]?.text).toContain("Slug: meridian");
    expect(deps.chatPublisher.pinned).toHaveLength(1);
    expect(deps.hackathonAnalysisRepo.rows[0]).toMatchObject({ threadId: 77 });
    // The pinned post IS the analysis; the ack must not send it a second time.
    expect(replies.at(-1)?.text).toBe("Se vinculó meridian a este tema.");
  });

  it("states in the ack that the topic's previous link was replaced", async () => {
    const { bot, replies, deps, teamId } = await hackathonTeam();
    deps.hackathonAnalysisRepo.rows.push(
      storedAnalysis(teamId, "alpha", { threadId: 77, pinnedMessageId: 900 }),
      storedAnalysis(teamId, "beta"),
    );

    await bot.handleUpdate(commandUpdate("hackathon", 10, 1, { threadId: 77, args: "beta" }));

    expect(deps.chatPublisher.unpinned).toEqual([900]);
    expect(replies.at(-1)?.text).toBe("Se reemplazó el vínculo anterior del tema (era alpha).");
    expect(deps.hackathonAnalysisRepo.rows.find((r) => r.slug === "alpha")?.threadId).toBeNull();
  });

  it("states in the ack that pinning failed but the analysis was posted", async () => {
    const { bot, replies, deps, teamId } = await hackathonTeam();
    deps.hackathonAnalysisRepo.rows.push(storedAnalysis(teamId, "meridian"));
    deps.chatPublisher.pin = async () => {
      throw new Error("no pin rights");
    };

    await bot.handleUpdate(commandUpdate("hackathon", 10, 1, { threadId: 77, args: "meridian" }));

    expect(deps.chatPublisher.posted).toHaveLength(1);
    expect(replies.at(-1)?.text).toBe("No se pudo fijar el mensaje; se publicó sin fijar.");
  });

  it("a non-admin member in a topic only sees the analysis, without linking or posting", async () => {
    const { bot, replies, deps, teamId } = await hackathonTeam();
    deps.hackathonAnalysisRepo.rows.push(storedAnalysis(teamId, "meridian"));

    await bot.handleUpdate(commandUpdate("hackathon", 10, 3, { threadId: 77, args: "meridian" }));

    expect(replies.at(-1)?.text).toContain("Slug: meridian");
    expect(deps.chatPublisher.posted).toHaveLength(0);
    expect(deps.hackathonAnalysisRepo.rows[0]?.threadId).toBeNull();
  });

  it("an admin in the general chat only sees the analysis (linking needs a topic)", async () => {
    const { bot, replies, deps, teamId } = await hackathonTeam();
    deps.hackathonAnalysisRepo.rows.push(storedAnalysis(teamId, "meridian"));

    await bot.handleUpdate(commandUpdate("hackathon", 10, 1, { args: "meridian" }));

    expect(replies.at(-1)?.text).toContain("Slug: meridian");
    expect(deps.chatPublisher.posted).toHaveLength(0);
  });

  it("does not treat a dotted argument as a slug", async () => {
    const { bot, replies, deps, teamId } = await hackathonTeam();
    deps.hackathonAnalysisRepo.rows.push(storedAnalysis(teamId, "meridian"));

    await bot.handleUpdate(commandUpdate("hackathon", 10, 1, { args: "meridian.dev" }));

    // "meridian.dev" is classified as a URL, which is not a public http(s)
    // URL: nothing is looked up, reserved or enqueued.
    expect(replies.at(-1)?.text).toBe("Solo se pueden analizar páginas públicas http(s).");
    expect(deps.analysisQuota.reserved).toHaveLength(0);
    expect(deps.analysisJobQueue.sent).toHaveLength(0);
  });
});

describe("registerCommands — /hackathon with no argument (hackathon-analysis spec: No-Argument Behavior)", () => {
  it("replies with the linked analysis inside a linked topic", async () => {
    const { bot, replies, deps, teamId } = await hackathonTeam();
    deps.hackathonAnalysisRepo.rows.push(storedAnalysis(teamId, "meridian", { threadId: 77 }));
    deps.hackathonAnalysisRepo.rows.push(storedAnalysis(teamId, "other", { threadId: 78 }));

    await bot.handleUpdate(commandUpdate("hackathon", 10, 3, { threadId: 77 }));

    expect(replies.at(-1)?.text).toContain("Slug: meridian");
    expect(replies.at(-1)?.text).not.toContain("other");
    expect(deps.analysisQuota.reserved).toHaveLength(0);
  });

  it("replies with usage inside a topic that has nothing linked", async () => {
    const { bot, replies, deps, teamId } = await hackathonTeam();
    deps.hackathonAnalysisRepo.rows.push(storedAnalysis(teamId, "other", { threadId: 78 }));

    await bot.handleUpdate(commandUpdate("hackathon", 10, 3, { threadId: 77 }));

    expect(replies.at(-1)?.text).toBe("Uso: /hackathon <url o slug>");
    expect(deps.analysisQuota.reserved).toHaveLength(0);
    expect(deps.analysisJobQueue.sent).toHaveLength(0);
  });

  it("replies with usage in the general chat", async () => {
    const { bot, replies, deps } = await hackathonTeam();

    await bot.handleUpdate(commandUpdate("hackathon", 10, 3));

    expect(replies.at(-1)?.text).toBe("Uso: /hackathon <url o slug>");
    expect(deps.analysisQuota.reserved).toHaveLength(0);
  });

  it("replies with usage for an argument with several words", async () => {
    const { bot, replies, deps } = await hackathonTeam();

    await bot.handleUpdate(commandUpdate("hackathon", 10, 1, { args: "two words" }));

    expect(replies.at(-1)?.text).toBe("Uso: /hackathon <url o slug>");
    expect(deps.analysisJobQueue.sent).toHaveLength(0);
  });
});

describe("registerCommands — /hackathon outside the group and on infrastructure failure", () => {
  it("tells a private-chat caller to use the team's group", async () => {
    const { bot, replies, deps } = makeBot([TEAM_ADMIN]);
    await bot.handleUpdate(commandUpdate("hackathon", 30, 30, { chatType: "private", args: "meridian" }));

    expect(replies[0]?.text).toBe("Ejecuta este comando dentro del chat grupal de tu equipo.");
    expect(deps.analysisJobQueue.sent).toHaveLength(0);
  });

  it("rethrows an unexpected repository failure instead of replying 200 (RES-001)", async () => {
    const { bot, deps } = await hackathonTeam();
    deps.hackathonAnalysisRepo.findBySlug = async () => {
      throw new Error("D1 exploded");
    };

    await expect(
      bot.handleUpdate(commandUpdate("hackathon", 10, 3, { args: "meridian" })),
    ).rejects.toThrow();
  });
});

describe("registerCommands — /hackathons (hackathon-analysis spec: Listing Is Read-Only and Truncated)", () => {
  it("lists slug, name, deadline and linked status for the team's analyses", async () => {
    const { bot, replies, deps, teamId } = await hackathonTeam();
    deps.hackathonAnalysisRepo.rows.push(
      storedAnalysis(teamId, "meridian", { threadId: 77 }),
      storedAnalysis(teamId, "orbit"),
    );

    await bot.handleUpdate(commandUpdate("hackathons", 10, 3));

    expect(replies.at(-1)?.text).toBe(
      [
        "meridian — Hack meridian — 2026-11-01 — vinculado",
        "orbit — Hack orbit — 2026-11-01 — no vinculado",
      ].join("\n"),
    );
    expect(deps.analysisQuota.reserved).toHaveLength(0);
  });

  it("replies with the empty message when nothing was analyzed", async () => {
    const { bot, replies } = await hackathonTeam();

    await bot.handleUpdate(commandUpdate("hackathons", 10, 3));

    expect(replies.at(-1)?.text).toBe("Todavía no se ha analizado ningún hackathon.");
  });

  it("truncates within 4096 characters and ends with a '…y N más' note", async () => {
    const { bot, replies, deps, teamId } = await hackathonTeam();
    const total = 200;
    for (let i = 0; i < total; i++) {
      deps.hackathonAnalysisRepo.rows.push(storedAnalysis(teamId, `event-${i}`));
    }

    await bot.handleUpdate(commandUpdate("hackathons", 10, 3));

    const text = replies.at(-1)!.text;
    expect(text.length).toBeLessThanOrEqual(4096);
    const listed = text.split("\n").filter((line) => line.startsWith("event-")).length;
    expect(listed).toBeGreaterThan(0);
    expect(listed).toBeLessThan(total);
    expect(text.endsWith(`…y ${total - listed} más`)).toBe(true);
  });

  it("only lists the caller's own team", async () => {
    const { bot, replies, deps } = await hackathonTeam();
    deps.hackathonAnalysisRepo.rows.push(storedAnalysis("team-other" as TeamId, "foreign"));

    await bot.handleUpdate(commandUpdate("hackathons", 10, 3));

    expect(replies.at(-1)?.text).toBe("Todavía no se ha analizado ningún hackathon.");
  });

  it("refuses a non-member", async () => {
    const { bot, replies } = await hackathonTeam();

    await bot.handleUpdate(commandUpdate("hackathons", 10, 999));

    expect(replies.at(-1)?.text).toBe("No eres miembro de este equipo.");
  });

  it("tells a private-chat caller to use the team's group", async () => {
    const { bot, replies } = makeBot([TEAM_ADMIN]);

    await bot.handleUpdate(commandUpdate("hackathons", 30, 30, { chatType: "private" }));

    expect(replies[0]?.text).toBe("Ejecuta este comando dentro del chat grupal de tu equipo.");
  });
});

// spec hackathon-analysis "Plain Text Replies": every reply is plain text
// (no parse_mode) and within Telegram's 4096-character limit.
describe("registerCommands — /hackathon and /hackathons replies are plain text within 4096 characters", () => {
  it("never sets parse_mode and never exceeds the limit, even for an oversized analysis", async () => {
    const { bot, payloads, deps, teamId, baseReplies } = await hackathonTeam();
    const oversized = storedAnalysis(teamId, "big");
    oversized.fields = {
      ...oversized.fields,
      name: { value: "x".repeat(6000), snippet: "", confidence: 0.9 },
    };
    deps.hackathonAnalysisRepo.rows.push(oversized, storedAnalysis(teamId, "meridian"));

    await bot.handleUpdate(commandUpdate("hackathon", 10, 3, { args: "big" }));
    await bot.handleUpdate(commandUpdate("hackathon", 10, 3, { args: "meridian" }));
    await bot.handleUpdate(commandUpdate("hackathon", 10, 1, { args: "https://example.com/event" }));
    await bot.handleUpdate(commandUpdate("hackathon", 10, 3));
    await bot.handleUpdate(commandUpdate("hackathons", 10, 3));

    const hackathonPayloads = payloads.slice(baseReplies);
    expect(hackathonPayloads).toHaveLength(5);
    for (const payload of hackathonPayloads) {
      expect(payload).not.toHaveProperty("parse_mode");
      expect((payload.text as string).length).toBeLessThanOrEqual(4096);
    }
  });
});

// Spanish copy for the remaining profile, role, unlink and picker replies.
describe("registerCommands — remaining Spanish replies", () => {
  it("/profile set replies with the Spanish confirmation and usage", async () => {
    const { bot, replies, deps } = makeBot([{ chatId: 10, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));
    await bot.handleUpdate(commandUpdate("profile", 10, 1, { args: "set full_name Ada" }));
    await bot.handleUpdate(commandUpdate("profile", 10, 1, { args: "set nope x" }));
    await bot.handleUpdate(commandUpdate("profile", 10, 1, { args: "wat" }));

    expect(replies[1]?.text).toBe(`Perfil actualizado para el equipo ${deps.teamRepo.rows[0]!.id}.`);
    expect(replies[2]?.text).toBe(
      "Uso: /profile set <full_name|emails|social_links|github_username> <valor>",
    );
    expect(replies[3]?.text).toBe("Uso: /profile show [membership-id] o /profile set <campo> <valor>");
  });

  it("/profile show renders the empty-member and no-fields copy", async () => {
    const { bot, replies, deps } = makeBot([{ chatId: 10, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));
    await bot.handleUpdate(commandUpdate("datachannel", 10, 1, { threadId: 77 }));
    await bot.handleUpdate(commandUpdate("profile", 10, 1, { threadId: 77, args: "show" }));
    expect(replies.at(-1)?.text).toContain("No hay campos de perfil configurados.");

    await bot.handleUpdate(commandUpdate("profile", 10, 1, { threadId: 77, args: "show missing-id" }));
    expect(replies.at(-1)?.text).toBe(
      `Equipo ${deps.teamRepo.rows[0]!.id}\nNo se encontró ningún miembro que coincida.`,
    );
  });

  it("/profile show refuses a non-member and /profile set refuses a non-registered caller", async () => {
    const { bot, replies } = makeBot([{ chatId: 10, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));
    await bot.handleUpdate(commandUpdate("datachannel", 10, 1, { threadId: 77 }));
    await bot.handleUpdate(commandUpdate("profile", 10, 9, { threadId: 77, args: "show" }));
    await bot.handleUpdate(commandUpdate("profile", 10, 9, { args: "set full_name Ada" }));

    expect(replies[2]?.text).toBe("No eres miembro de este equipo.");
    expect(replies[3]?.text).toBe("No eres miembro de este equipo.");
  });

  it("/promote and /demote reply with Spanish usage and refusals", async () => {
    const { bot, replies, deps } = makeBot([{ chatId: 10, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));
    await bot.handleUpdate(commandUpdate("join", 10, 3));
    const adminId = deps.membershipRepo.rows[0]!.id;
    await bot.handleUpdate(commandUpdate("promote", 10, 1));
    await bot.handleUpdate(commandUpdate("promote", 10, 1, { args: "missing-id" }));
    await bot.handleUpdate(commandUpdate("demote", 10, 3, { args: adminId }));

    expect(replies[2]?.text).toBe("Uso: /promote <membership-id>");
    expect(replies[3]?.text).toBe("No se encontró al miembro en este equipo.");
    expect(replies[4]?.text).toBe("Solo un administrador del equipo puede cambiar roles.");
  });

  it("/demote refuses to demote the last admin", async () => {
    const { bot, replies, deps } = makeBot([{ chatId: 10, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));
    const adminId = deps.membershipRepo.rows[0]!.id;
    await bot.handleUpdate(commandUpdate("demote", 10, 1, { args: adminId }));

    expect(replies[1]?.text).toBe("No se puede degradar al último administrador del equipo.");
  });

  it("/unlinkrepo reports a repo that was not linked and usage in Spanish", async () => {
    const { bot, replies } = makeBot([{ chatId: 10, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));
    await bot.handleUpdate(commandUpdate("unlinkrepo", 10, 1, { threadId: 77, args: "owner/repo" }));
    await bot.handleUpdate(commandUpdate("unlinkrepo", 10, 1, { threadId: 77, args: "not-a-repo" }));

    expect(replies[1]?.text).toBe("owner/repo no estaba vinculado a ningún tema.");
    expect(replies[2]?.text).toBe("Uso: /unlinkrepo <owner/repo o URL del repositorio de GitHub>");
  });

  it("/profile in a DM with no membership tells the caller to join a team first", async () => {
    const { bot, replies } = makeBot();
    await bot.handleUpdate(commandUpdate("profile", 50, 5, { chatType: "private", args: "show" }));

    expect(replies[0]?.text).toBe("Primero únete a un equipo ejecutando /join en su grupo.");
  });

  it("the team picker labels each button 'Equipo {id}'", async () => {
    const { bot, payloads, deps } = makeBot([{ chatId: 10, userId: 1 }, { chatId: 20, userId: 1 }]);
    await bot.handleUpdate(commandUpdate("setup", 10, 1));
    await bot.handleUpdate(commandUpdate("setup", 20, 1));
    await bot.handleUpdate(commandUpdate("profile", 50, 1, { chatType: "private", args: "show" }));

    const markup = payloads.at(-1)?.reply_markup as {
      inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
    };
    const buttons = markup.inline_keyboard.flat();
    expect(buttons.map((b) => b.text)).toEqual(deps.teamRepo.rows.map((t) => `Equipo ${t.id}`));
  });
});
