import { Bot } from "grammy";
import type { Update } from "grammy/types";
import { describe, expect, it } from "vitest";
import { registerNaturalLanguage } from "../../../src/adapters/telegram/natural-language";
import { asMemberId, asMembershipId, asTeamId } from "../../../src/domain/ids";
import { feedbackCopy } from "../../../src/domain/copy";
import { createSafeLogger } from "../../../src/adapters/log/safe-logger";
import {
  fakeAnalysisJobQueue,
  fakeAnalysisJobRepo,
  fakeAnalysisQuota,
  fakeChatAdminChecker,
  fakeChatPublisher,
  fakeClock,
  fakeFeedbackRepo,
  fakeForumTopicManager,
  fakeGithubOrgClaimRepo,
  fakeHackathonAnalysisRepo,
  fakeIdGen,
  fakeIntentClassifier,
  fakeMemberRepo,
  fakeMembershipRepo,
  fakeNlClassifyQuota,
  fakeNlConfirmationRepo,
  fakeProfileRepo,
  fakeRepoTopicLinkRepo,
  fakeSleep,
  fakeTeamRepo,
} from "../../fakes";

function makeBot(opts: {
  intentClassifierFn?: Parameters<typeof fakeIntentClassifier>[0];
  transcribeResult?: string;
  transcribeThrows?: boolean;
} = {}) {
  const bot = new Bot("123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11", {
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
        result: { message_id: replies.length, date: 0, chat: { id: p.chat_id, type: "supergroup" } },
      } as never);
    }
    return Promise.resolve({ ok: true, result: {} } as never);
  });

  const teamRepo = fakeTeamRepo();
  const memberRepo = fakeMemberRepo();
  const membershipRepo = fakeMembershipRepo(memberRepo);
  const feedbackRepo = fakeFeedbackRepo();
  const intentClassifier = fakeIntentClassifier(opts.intentClassifierFn);

  const downloadedFileIds: string[] = [];
  const voiceDownloader = {
    download: async (fileId: string) => {
      downloadedFileIds.push(fileId);
      return new Uint8Array([1, 2, 3]).buffer;
    },
  };

  const speechToText = {
    transcribe: async () => {
      if (opts.transcribeThrows) throw new Error("Whisper failed");
      return opts.transcribeResult ?? "audio transcription";
    },
  };

  const feedbackSynthesizer = {
    summarize: async (notes: unknown[]) => `Resumen sintético de ${notes.length} notas.`,
  };

  const deps = {
    teamRepo,
    memberRepo,
    membershipRepo,
    profileRepo: fakeProfileRepo(),
    hackathonAnalysisRepo: fakeHackathonAnalysisRepo(),
    repoTopicLinkRepo: fakeRepoTopicLinkRepo(),
    githubOrgClaimRepo: fakeGithubOrgClaimRepo(),
    analysisQuota: fakeAnalysisQuota(),
    analysisJobRepo: fakeAnalysisJobRepo(),
    analysisJobQueue: fakeAnalysisJobQueue(),
    chatAdminChecker: fakeChatAdminChecker([]),
    chatPublisher: fakeChatPublisher(),
    forumTopicManager: fakeForumTopicManager(),
    nlClassifyQuota: fakeNlClassifyQuota({ allow: true }),
    nlConfirmationRepo: fakeNlConfirmationRepo(),
    intentClassifier,
    sleep: fakeSleep(),
    clock: fakeClock(),
    idGen: fakeIdGen(),
    logger: createSafeLogger(),
    nlModelPrimary: "@cf/test/model",
    feedbackRepo,
    feedbackSynthesizer,
    speechToText,
    voiceDownloader,
  };

  registerNaturalLanguage(bot, deps);

  // Seed team & member
  const teamId = asTeamId("team-nl-group");
  const memberId = asMemberId("member-nl-1");
  const membershipId = asMembershipId("membership-nl-1");

  teamRepo.rows.push({
    id: teamId,
    chatId: -100123456,
    dataTopicThreadId: null,
    createdAt: 0,
  });
  memberRepo.rows.push({
    id: memberId,
    telegramUserId: 42,
    createdAt: 0,
  });
  membershipRepo.rows.push({
    id: membershipId,
    teamId,
    memberId,
    role: "member",
    joinedAt: 0,
  });

  return { bot, deps, replies, downloadedFileIds, teamId, membershipId };
}

let nextUpdateId = 1000;

describe("Natural Language Adapter — Feedback Flows", () => {
  it("captures text feedback via @bot mention in a group", async () => {
    const { bot, deps, replies } = makeBot({
      intentClassifierFn: () => ({
        intent: "capture_feedback",
        confidence: 0.95,
        slots: { feedbackText: "Error 500 al guardar perfil", repo: "org/puls3" },
      }),
    });

    const update: Update = {
      update_id: nextUpdateId++,
      message: {
        message_id: 101,
        date: 0,
        chat: { id: -100123456, type: "supergroup", title: "Dev Group" },
        from: { id: 42, is_bot: false, first_name: "Alice" },
        text: "@test_bot encontré un bug: Error 500 al guardar perfil",
      },
    };

    await bot.handleUpdate(update);

    expect(replies).toHaveLength(1);
    expect(replies[0]?.text).toContain("Nota guardada en el buzón");
    expect(replies[0]?.text).toContain("org/puls3");
    expect(deps.feedbackRepo.rows).toHaveLength(1);
    expect(deps.feedbackRepo.rows[0]?.rawText).toBe("Error 500 al guardar perfil");
    expect(deps.feedbackRepo.rows[0]?.sourceType).toBe("text");
    expect(deps.feedbackRepo.rows[0]?.status).toBe("inbox");
  });

  it("captures voice note feedback via voice message in group", async () => {
    const { bot, deps, replies, downloadedFileIds } = makeBot({
      transcribeResult: "hay un problema con el audio en la demo",
      intentClassifierFn: () => ({
        intent: "capture_feedback",
        confidence: 0.92,
        slots: { feedbackText: "hay un problema con el audio en la demo" },
      }),
    });

    const update: Update = {
      update_id: nextUpdateId++,
      message: {
        message_id: 102,
        date: 0,
        chat: { id: -100123456, type: "supergroup", title: "Dev Group" },
        from: { id: 42, is_bot: false, first_name: "Alice" },
        message_thread_id: 55, // topic
        voice: {
          file_id: "voice-file-xyz",
          file_unique_id: "voice-unique-xyz",
          duration: 3,
        },
      },
    };

    await bot.handleUpdate(update);

    expect(downloadedFileIds).toEqual(["voice-file-xyz"]);
    expect(replies).toHaveLength(1);
    expect(replies[0]?.text).toContain("Nota guardada en el buzón");
    expect(deps.feedbackRepo.rows).toHaveLength(1);
    expect(deps.feedbackRepo.rows[0]?.rawText).toBe("hay un problema con el audio en la demo");
    expect(deps.feedbackRepo.rows[0]?.sourceType).toBe("voice");
    expect(deps.feedbackRepo.rows[0]?.status).toBe("inbox");
  });

  it("replies with friendly failure message when audio transcription is empty", async () => {
    const { bot, replies } = makeBot({
      transcribeResult: "   ",
    });

    const update: Update = {
      update_id: nextUpdateId++,
      message: {
        message_id: 103,
        date: 0,
        chat: { id: -100123456, type: "supergroup", title: "Dev Group" },
        from: { id: 42, is_bot: false, first_name: "Alice" },
        message_thread_id: 55,
        voice: {
          file_id: "voice-empty",
          file_unique_id: "voice-empty-unique",
          duration: 1,
        },
      },
    };

    await bot.handleUpdate(update);

    expect(replies).toHaveLength(1);
    expect(replies[0]?.text).toBe(feedbackCopy.voiceFailed);
  });

  it("replies with friendly failure message when whisper throws", async () => {
    const { bot, replies } = makeBot({
      transcribeThrows: true,
    });

    const update: Update = {
      update_id: nextUpdateId++,
      message: {
        message_id: 104,
        date: 0,
        chat: { id: -100123456, type: "supergroup", title: "Dev Group" },
        from: { id: 42, is_bot: false, first_name: "Alice" },
        message_thread_id: 55,
        voice: {
          file_id: "voice-throw",
          file_unique_id: "voice-throw-unique",
          duration: 2,
        },
      },
    };

    await bot.handleUpdate(update);

    expect(replies).toHaveLength(1);
    expect(replies[0]?.text).toBe(feedbackCopy.voiceFailed);
  });

  it("lists pending feedback via natural language", async () => {
    const { bot, deps, replies, teamId, membershipId } = makeBot({
      intentClassifierFn: () => ({
        intent: "list_feedback",
        confidence: 0.9,
        slots: {},
      }),
    });

    await deps.feedbackRepo.save(teamId, {
      id: "note-123456",
      teamId,
      authorMembershipId: membershipId,
      repoHint: "puls3",
      rawText: "El login no funciona en staging",
      sourceType: "text",
      status: "inbox",
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    });

    const update: Update = {
      update_id: nextUpdateId++,
      message: {
        message_id: 105,
        date: 0,
        chat: { id: -100123456, type: "supergroup", title: "Dev Group" },
        from: { id: 42, is_bot: false, first_name: "Alice" },
        text: "@test_bot lista las notas de feedback",
      },
    };

    await bot.handleUpdate(update);

    expect(replies).toHaveLength(1);
    expect(replies[0]?.text).toContain("Observaciones pendientes (1)");
    expect(replies[0]?.text).toContain("El login no funciona en staging");
  });

  it("synthesizes feedback via natural language", async () => {
    const { bot, deps, replies, teamId, membershipId } = makeBot({
      intentClassifierFn: () => ({
        intent: "summarize_feedback",
        confidence: 0.9,
        slots: {},
      }),
    });

    await deps.feedbackRepo.save(teamId, {
      id: "note-abc",
      teamId,
      authorMembershipId: membershipId,
      repoHint: "puls3",
      rawText: "Bug en auth",
      sourceType: "voice",
      status: "inbox",
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    });

    const update: Update = {
      update_id: nextUpdateId++,
      message: {
        message_id: 106,
        date: 0,
        chat: { id: -100123456, type: "supergroup", title: "Dev Group" },
        from: { id: 42, is_bot: false, first_name: "Alice" },
        text: "@test_bot resume el feedback acumulado",
      },
    };

    await bot.handleUpdate(update);

    expect(replies).toHaveLength(1);
    expect(replies[0]?.text).toContain("Resumen de 1 observación");
    expect(replies[0]?.text).toContain("Resumen sintético de 1 notas.");
  });

  it("archives feedback via natural language", async () => {
    const { bot, deps, replies, teamId, membershipId } = makeBot({
      intentClassifierFn: () => ({
        intent: "archive_feedback",
        confidence: 0.9,
        slots: { noteIds: ["note-abc"] },
      }),
    });

    await deps.feedbackRepo.save(teamId, {
      id: "note-abc",
      teamId,
      authorMembershipId: membershipId,
      repoHint: "puls3",
      rawText: "Bug en auth",
      sourceType: "text",
      status: "inbox",
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    });

    const update: Update = {
      update_id: nextUpdateId++,
      message: {
        message_id: 107,
        date: 0,
        chat: { id: -100123456, type: "supergroup", title: "Dev Group" },
        from: { id: 42, is_bot: false, first_name: "Alice" },
        text: "@test_bot archiva note-abc",
      },
    };

    await bot.handleUpdate(update);

    expect(replies).toHaveLength(1);
    expect(replies[0]?.text).toBe("1 observación archivada.");
    expect(deps.feedbackRepo.rows[0]?.status).toBe("triaged");
  });
});
