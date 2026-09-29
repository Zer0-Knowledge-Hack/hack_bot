import { describe, expect, it } from "vitest";
import { participateCopy } from "../../../src/adapters/telegram/copy";
import { runParticipation } from "../../../src/adapters/telegram/participation";
import { PublishFailedError } from "../../../src/domain/errors";
import type { HackathonAnalysis } from "../../../src/domain/entities";
import { asMemberId, asMembershipId, asTeamId } from "../../../src/domain/ids";
import {
  fakeChatPublisher,
  fakeClock,
  fakeForumTopicManager,
  fakeHackathonAnalysisRepo,
  fakeLogger,
  fakeMemberRepo,
  fakeMembershipRepo,
} from "../../fakes";
import type { TopicCreateStep } from "../../fakes";

const teamId = asTeamId("team-1");
const CHAT_ID = -1001234567890;
const ADMIN = asMembershipId("m-admin");

function analysis(): HackathonAnalysis {
  return {
    id: "a-1",
    teamId,
    slug: "meridian",
    sourceUrl: "https://example.com/meridian",
    normalizedUrl: "https://example.com/meridian",
    fields: {
      name: { value: "Meridian", snippet: "", confidence: 0.9 },
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
  };
}

function setup(opts: { role?: "admin" | "member"; create?: TopicCreateStep[]; seed?: boolean } = {}) {
  const memberRepo = fakeMemberRepo();
  const membershipRepo = fakeMembershipRepo(memberRepo);
  membershipRepo.rows.push({
    id: ADMIN,
    teamId,
    memberId: asMemberId("u-admin"),
    role: opts.role ?? "admin",
    joinedAt: 0,
  });
  const hackathonAnalysisRepo = fakeHackathonAnalysisRepo();
  if (opts.seed !== false) hackathonAnalysisRepo.rows.push(analysis());
  const deps = {
    membershipRepo,
    hackathonAnalysisRepo,
    chatPublisher: fakeChatPublisher(),
    forumTopicManager: fakeForumTopicManager(opts.create ? { create: opts.create } : {}),
    clock: fakeClock(),
    logger: fakeLogger(),
  };
  const replies: string[] = [];
  const params = (slug = "meridian") => ({
    event: "hackathon-join",
    teamId,
    membershipId: ADMIN,
    chatId: CHAT_ID,
    slug,
    callbackMessageId: null,
    reply: async (text: string) => {
      replies.push(text);
    },
  });
  return { deps, replies, params };
}

describe("runParticipation: domain errors map to their Spanish reply", () => {
  it("non-admin: adminOnly, nothing created", async () => {
    const { deps, replies, params } = setup({ role: "member" });
    await runParticipation(params(), deps);
    expect(replies).toEqual(["Solo un administrador del equipo puede confirmar la participación."]);
    expect(deps.forumTopicManager.created).toHaveLength(0);
  });

  it("unknown slug: noAnalysis(slug)", async () => {
    const { deps, replies, params } = setup();
    await runParticipation(params("nope"), deps);
    expect(replies).toEqual(["No se encontró ningún análisis con el slug nope."]);
  });

  it.each([
    ["no-rights", "No puedo crear temas: concede al bot el permiso «Administrar temas» y vuelve a intentarlo."],
    [
      "not-forum",
      "Este grupo no tiene los temas activados. Actívalos en la configuración del grupo y vuelve a intentarlo.",
    ],
    ["rate-limited", "Telegram rechazó la creación del tema. Inténtalo de nuevo en un minuto."],
    ["rejected", "Telegram rechazó la creación del tema. Inténtalo de nuevo en un minuto."],
    [
      "unavailable",
      "No se pudo confirmar si se creó el tema. Revisa la lista de temas antes de volver a intentarlo.",
    ],
  ] as const)("create failure %s replies with the design copy", async (failure, text) => {
    const { deps, replies, params } = setup({ create: [{ fails: failure }] });
    await runParticipation(params(), deps);
    expect(replies).toEqual([text]);
    expect(deps.chatPublisher.posted).toHaveLength(0);
  });

  it("logs a refusal with the error name and no reply to General", async () => {
    const { deps, params } = setup({ role: "member" });
    await runParticipation(params(), deps);
    expect(deps.logger.entries).toContainEqual({
      event: "hackathon-join",
      teamId,
      outcome: "refused",
      errorCode: "UnauthorizedError",
    });
    expect(deps.chatPublisher.posted).toHaveLength(0);
  });

  it("rethrows an unrecognized error after logging it", async () => {
    const { deps, params } = setup();
    deps.hackathonAnalysisRepo.findBySlug = async () => {
      throw new Error("D1 unavailable");
    };
    await expect(runParticipation(params(), deps)).rejects.toThrow("D1 unavailable");
    expect(deps.logger.entries.at(-1)).toMatchObject({ outcome: "error", errorCode: "Error" });
  });
});

describe("runParticipation: replies go to General through a safe post", () => {
  it("posts the confirmation to General (null thread)", async () => {
    const { deps, replies, params } = setup({ create: [{ threadId: 77 }] });
    await runParticipation(params(), deps);
    const general = deps.chatPublisher.posted.find((p) => p.threadId === null);
    expect(general).toEqual({
      chatId: CHAT_ID,
      threadId: null,
      text: "✅ Participamos en Meridian → https://t.me/c/1234567890/77",
    });
    expect(replies).toEqual([]);
  });

  it("a failing General post is caught and logged, never rethrown", async () => {
    const { deps, params } = setup({ create: [{ threadId: 77 }] });
    const realPost = deps.chatPublisher.post;
    deps.chatPublisher.post = async (chatId, threadId, text, options) => {
      if (threadId === null) throw new PublishFailedError("general", "telegram-unavailable");
      return realPost(chatId, threadId, text, options);
    };

    await expect(runParticipation(params(), deps)).resolves.toBeUndefined();

    expect(deps.hackathonAnalysisRepo.rows[0]?.threadId).toBe(77);
    expect(deps.logger.entries).toContainEqual({
      event: "hackathon-join",
      teamId,
      outcome: "error",
      errorCode: "PublishFailedError",
      reason: "general-post-failed",
    });
  });

  it("posts nothing for a neutral busy no-op", async () => {
    const { deps, replies, params } = setup();
    deps.hackathonAnalysisRepo.claims.set("a-1", deps.clock.now() + 60_000);
    await runParticipation(params(), deps);
    expect(deps.chatPublisher.posted).toHaveLength(0);
    expect(replies).toEqual([]);
  });
});

describe("participateCopy", () => {
  it("exposes the design strings", () => {
    expect(participateCopy.joinUsage).toBe("Uso: /hackathon join <slug>");
    expect(participateCopy.noAnalysis("x")).toBe("No se encontró ningún análisis con el slug x.");
  });
});
