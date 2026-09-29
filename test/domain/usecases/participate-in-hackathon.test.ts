import { describe, expect, it } from "vitest";
import {
  AnalysisNotFoundError,
  ChatNotForumError,
  PublishFailedError,
  TopicCreationFailedError,
  TopicCreationUncertainError,
  TopicRightsMissingError,
  UnauthorizedError,
} from "../../../src/domain/errors";
import type { HackathonAnalysis } from "../../../src/domain/entities";
import { asMemberId, asMembershipId, asTeamId } from "../../../src/domain/ids";
import { participateInHackathon } from "../../../src/domain/usecases/participate-in-hackathon";
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
const LINK = (threadId: number) => `https://t.me/c/1234567890/${threadId}`;
const ADMIN = asMembershipId("m-admin");

function analysis(overrides: Partial<HackathonAnalysis> = {}): HackathonAnalysis {
  return {
    id: "a-1",
    teamId,
    slug: "meridian",
    sourceUrl: "https://example.com/meridian",
    normalizedUrl: "https://example.com/meridian",
    fields: {
      name: { value: "Meridian  Hack\n2026", snippet: "", confidence: 0.9 },
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
    ...overrides,
  };
}

function setup(
  opts: {
    row?: Partial<HackathonAnalysis>;
    create?: TopicCreateStep[];
    role?: "admin" | "member";
  } = {},
) {
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
  hackathonAnalysisRepo.rows.push(analysis(opts.row ?? {}));
  return {
    membershipRepo,
    hackathonAnalysisRepo,
    chatPublisher: fakeChatPublisher(),
    forumTopicManager: fakeForumTopicManager({
      ...(opts.create ? { create: opts.create } : {}),
    }),
    clock: fakeClock(),
    logger: fakeLogger(),
  };
}

const input = (over: Partial<{ callbackMessageId: number | null; slug: string; chatId: number }> = {}) => ({
  teamId,
  actorMembershipId: ADMIN,
  chatId: CHAT_ID,
  slug: "meridian",
  callbackMessageId: null,
  ...over,
});

// The user deleted the topic: Telegram rejects (4xx) a post into that thread.
function rejectPostsTo(deps: ReturnType<typeof setup>, deletedThreadId: number) {
  const realPost = deps.chatPublisher.post;
  deps.chatPublisher.post = async (chatId, threadId, text, options) => {
    if (threadId === deletedThreadId) throw new PublishFailedError("sendMessage failed", "thread-gone");
    return realPost(chatId, threadId, text, options);
  };
}

const row = (deps: ReturnType<typeof setup>) => deps.hackathonAnalysisRepo.rows[0]!;

describe("participateInHackathon: gate and lookup", () => {
  it("refuses a non-admin with UnauthorizedError and changes nothing", async () => {
    const deps = setup({ role: "member" });
    await expect(participateInHackathon(input(), deps)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(deps.forumTopicManager.created).toHaveLength(0);
    expect(row(deps).threadId).toBeNull();
    expect(deps.hackathonAnalysisRepo.claims.size).toBe(0);
  });

  it("refuses a caller with no membership with UnauthorizedError", async () => {
    const deps = setup();
    await expect(
      participateInHackathon(input(), {
        ...deps,
        membershipRepo: fakeMembershipRepo(fakeMemberRepo()),
      }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(deps.forumTopicManager.created).toHaveLength(0);
  });

  it("throws AnalysisNotFoundError for an unknown slug and creates nothing", async () => {
    const deps = setup();
    await expect(participateInHackathon(input({ slug: "nope" }), deps)).rejects.toBeInstanceOf(
      AnalysisNotFoundError,
    );
    expect(deps.forumTopicManager.created).toHaveLength(0);
    expect(deps.chatPublisher.posted).toHaveLength(0);
  });
});

describe("participateInHackathon: happy path", () => {
  it("creates, links, pins in the topic and returns the General confirmation", async () => {
    const deps = setup({ create: [{ threadId: 77 }] });

    const result = await participateInHackathon(input(), deps);

    expect(deps.forumTopicManager.created).toEqual([
      { chatId: CHAT_ID, name: "🏆 Meridian Hack 2026" },
    ]);
    expect(row(deps).threadId).toBe(77);
    expect(deps.chatPublisher.posted).toHaveLength(1);
    expect(deps.chatPublisher.posted[0]?.threadId).toBe(77);
    expect(deps.chatPublisher.pinned).toHaveLength(1);
    expect(row(deps).pinnedMessageId).toBe(1);
    expect(result.kind).toBe("created");
    expect(result.replyText).toBe(`✅ Participamos en Meridian Hack 2026 → ${LINK(77)}`);
  });

  it("names the topic after the slug when the analysis has no name", async () => {
    const deps = setup({
      row: { fields: { ...analysis().fields, name: null } },
      create: [{ threadId: 5 }],
    });
    const result = await participateInHackathon(input(), deps);
    expect(deps.forumTopicManager.created[0]?.name).toBe("🏆 meridian");
    expect(result.replyText).toBe(`✅ Participamos en meridian → ${LINK(5)}`);
  });

  it("omits the link when the chat id has no t.me/c form", async () => {
    const deps = setup({ create: [{ threadId: 5 }] });
    const result = await participateInHackathon(input({ chatId: -555 }), deps);
    expect(result.replyText).toBe("✅ Participamos en Meridian Hack 2026");
  });
});

describe("participateInHackathon: redelivery and live topics", () => {
  it("never creates a second topic on redelivery: already(link), exactly one create", async () => {
    const deps = setup({ create: [{ threadId: 77 }] });

    const first = await participateInHackathon(input(), deps);
    const second = await participateInHackathon(input(), deps);

    expect(first.kind).toBe("created");
    expect(second).toEqual({
      kind: "already",
      replyText: `Este hackathon ya tiene tema: ${LINK(77)}`,
    });
    expect(deps.forumTopicManager.created).toHaveLength(1);
  });

  it("verifies a live topic by posting the analysis into it: already(link), re-pinned, no create", async () => {
    const deps = setup({ row: { threadId: 40, pinnedMessageId: 8, generalMessageId: 900 } });
    const result = await participateInHackathon(input({ callbackMessageId: 901 }), deps);
    expect(result).toEqual({ kind: "already", replyText: `Este hackathon ya tiene tema: ${LINK(40)}` });
    expect(deps.chatPublisher.posted).toHaveLength(1);
    expect(deps.chatPublisher.posted[0]?.threadId).toBe(40);
    expect(deps.chatPublisher.pinned).toEqual([1]);
    expect(row(deps).threadId).toBe(40);
    expect(row(deps).pinnedMessageId).toBe(1);
    expect(deps.forumTopicManager.created).toHaveLength(0);
    expect(deps.hackathonAnalysisRepo.claims.size).toBe(0);
    expect(deps.chatPublisher.cleared).toEqual([
      { chatId: CHAT_ID, messageId: 901 },
      { chatId: CHAT_ID, messageId: 900 },
    ]);
  });

  const failures: Array<[string, () => Error, string]> = [
    ["rejected (closed topic / 403 on a live topic)", () => new PublishFailedError("sendMessage failed", "rejected"), "PublishFailedError"],
    ["telegram-unavailable", () => new PublishFailedError("sendMessage failed", "telegram-unavailable"), "PublishFailedError"],
    ["rate-limited", () => new PublishFailedError("sendMessage failed", "rate-limited"), "PublishFailedError"],
    ["an unexpected non-PublishFailedError", () => new TypeError("boom"), "TypeError"],
  ];
  it.each(failures)(
    "keeps the link and does not recreate when the verifying post fails as %s",
    async (_label, makeError, errorName) => {
      const deps = setup({ row: { threadId: 40, generalMessageId: 900 } });
      deps.chatPublisher.post = async () => {
        throw makeError();
      };
      const result = await participateInHackathon(input(), deps);
      expect(result).toEqual({ kind: "already", replyText: `Este hackathon ya tiene tema: ${LINK(40)}` });
      expect(deps.forumTopicManager.created).toHaveLength(0);
      expect(deps.hackathonAnalysisRepo.claims.size).toBe(0);
      expect(row(deps).threadId).toBe(40);
      expect(deps.chatPublisher.cleared).toEqual([{ chatId: CHAT_ID, messageId: 900 }]);
      expect(deps.logger.entries).toContainEqual(
        expect.objectContaining({
          event: "hackathon-participate",
          outcome: "error",
          reason: "topic-check-failed",
          errorCode: errorName,
        }),
      );
    },
  );

  it("never creates a second topic after a recreation: the redelivery posts into the new thread", async () => {
    const deps = setup({ row: { threadId: 40 }, create: [{ threadId: 41 }, { threadId: 42 }] });
    rejectPostsTo(deps, 40);

    const first = await participateInHackathon(input(), deps);
    const second = await participateInHackathon(input(), deps);

    expect(first.kind).toBe("created");
    expect(second).toEqual({ kind: "already", replyText: `Este hackathon ya tiene tema: ${LINK(41)}` });
    expect(deps.forumTopicManager.created).toHaveLength(1);
  });
});

describe("participateInHackathon: deleted topic", () => {
  it("detects the deleted topic from a rejected post, recreates it, replaces the stale id, no moved note", async () => {
    const deps = setup({
      row: { threadId: 40, pinnedMessageId: 8 },
      create: [{ threadId: 41 }],
    });
    rejectPostsTo(deps, 40);

    const result = await participateInHackathon(input(), deps);

    expect(deps.forumTopicManager.created).toHaveLength(1);
    expect(row(deps).threadId).toBe(41);
    expect(result.kind).toBe("created");
    expect(result.replyText).toBe(`✅ Participamos en Meridian Hack 2026 → ${LINK(41)}`);
    expect(deps.chatPublisher.unpinned).toEqual([]);
    expect(deps.chatPublisher.posted.map((p) => p.threadId)).toEqual([41]);
  });

  it("claims with the stale id: a concurrent relink to a new id makes the claim lose", async () => {
    const deps = setup({ row: { threadId: 40 }, create: [{ threadId: 41 }] });
    rejectPostsTo(deps, 40);
    const realFind = deps.hackathonAnalysisRepo.findBySlug;
    let reads = 0;
    // First read still shows the stale id; then another tap relinks it to 50.
    deps.hackathonAnalysisRepo.findBySlug = async (t, s) => {
      const found = await realFind(t, s);
      reads += 1;
      if (reads === 1 && found) {
        const snapshot = { ...found };
        found.threadId = 50;
        return snapshot;
      }
      return found;
    };

    const result = await participateInHackathon(input(), deps);

    expect(result).toEqual({ kind: "already", replyText: `Este hackathon ya tiene tema: ${LINK(50)}` });
    expect(deps.forumTopicManager.created).toHaveLength(0);
  });
});

describe("participateInHackathon: concurrent claim", () => {
  it("returns busy (neutral no-op) when another live claim holds the row", async () => {
    const deps = setup();
    deps.hackathonAnalysisRepo.claims.set("a-1", deps.clock.now() + 60_000);

    const result = await participateInHackathon(input(), deps);

    expect(result).toEqual({ kind: "busy", replyText: null });
    expect(deps.forumTopicManager.created).toHaveLength(0);
    expect(deps.chatPublisher.posted).toHaveLength(0);
  });

  it("returns already(link) when the claim is lost and the re-read shows a link", async () => {
    const deps = setup();
    const realFind = deps.hackathonAnalysisRepo.findBySlug;
    let reads = 0;
    // The winner links between our first read and our re-read.
    deps.hackathonAnalysisRepo.findBySlug = async (t, s) => {
      const found = await realFind(t, s);
      reads += 1;
      if (reads === 1 && found) {
        const snapshot = { ...found };
        found.threadId = 55;
        return snapshot;
      }
      return found;
    };
    deps.hackathonAnalysisRepo.claims.set("a-1", deps.clock.now() + 60_000);

    const result = await participateInHackathon(input(), deps);

    expect(result).toEqual({ kind: "already", replyText: `Este hackathon ya tiene tema: ${LINK(55)}` });
    expect(deps.forumTopicManager.created).toHaveLength(0);
  });

  it("creates exactly one topic when the second call arrives while the first claim is live", async () => {
    const deps = setup({ create: [{ threadId: 60 }, { threadId: 61 }] });
    // Two callers race: both read the unlinked row, only one wins the claim.
    const [a, b] = await Promise.all([
      participateInHackathon(input(), deps),
      participateInHackathon(input(), deps),
    ]);
    expect(deps.forumTopicManager.created).toHaveLength(1);
    // Depending on interleaving the loser sees the link already stored
    // ("already") or not yet ("busy"); either way it must not create.
    const kinds = [a.kind, b.kind];
    expect(kinds.filter((k) => k === "created")).toHaveLength(1);
    expect(kinds.filter((k) => k === "busy" || k === "already")).toHaveLength(1);
  });
});

describe("participateInHackathon: creation failures", () => {
  it.each([
    ["no-rights", TopicRightsMissingError],
    ["not-forum", ChatNotForumError],
    ["rate-limited", TopicCreationFailedError],
    ["rejected", TopicCreationFailedError],
  ] as const)("%s persists nothing and releases the claim", async (failure, ErrorClass) => {
    const deps = setup({ create: [{ fails: failure }] });

    await expect(participateInHackathon(input(), deps)).rejects.toBeInstanceOf(ErrorClass);

    expect(row(deps).threadId).toBeNull();
    expect(deps.chatPublisher.posted).toHaveLength(0);
    expect(deps.hackathonAnalysisRepo.claims.get("a-1")).toBe(0);
  });

  it("keeps the claim on an uncertain outcome so a retry cannot duplicate", async () => {
    const deps = setup({ create: [{ fails: "unavailable" }, { threadId: 9 }] });

    await expect(participateInHackathon(input(), deps)).rejects.toBeInstanceOf(
      TopicCreationUncertainError,
    );
    expect(deps.hackathonAnalysisRepo.claims.get("a-1")).toBeGreaterThan(deps.clock.now());
    expect(row(deps).threadId).toBeNull();

    const retry = await participateInHackathon(input(), deps);
    expect(retry.kind).toBe("busy");
    expect(deps.forumTopicManager.created).toHaveLength(1);
  });

  it("keeps the claim and rethrows an unknown create error (the topic may exist)", async () => {
    const deps = setup();
    const boom = new TypeError("unexpected create failure");
    deps.forumTopicManager.create = async () => {
      throw boom;
    };

    await expect(participateInHackathon(input(), deps)).rejects.toBe(boom);

    expect(deps.hackathonAnalysisRepo.claims.get("a-1")).toBeGreaterThan(deps.clock.now());
    expect(row(deps).threadId).toBeNull();
    expect(deps.chatPublisher.posted).toHaveLength(0);
  });
});

describe("participateInHackathon: after the topic exists (never rethrows)", () => {
  it("reports a pin failure as a note; posted unpinned and the link persists", async () => {
    const deps = setup({ create: [{ threadId: 77 }] });
    deps.chatPublisher.pin = async () => {
      throw new PublishFailedError("pin", "rejected");
    };

    const result = await participateInHackathon(input(), deps);

    expect(result.kind).toBe("created");
    expect(result.replyText).toBe(
      `✅ Participamos en Meridian Hack 2026 → ${LINK(77)}\nNo se pudo fijar el mensaje; se publicó sin fijar.`,
    );
    expect(row(deps).threadId).toBe(77);
    expect(row(deps).pinnedMessageId).toBeNull();
    expect(deps.chatPublisher.posted).toHaveLength(1);
  });

  it("returns postFailed with the link when posting the analysis fails", async () => {
    const deps = setup({ create: [{ threadId: 77 }] });
    deps.chatPublisher.post = async () => {
      throw new PublishFailedError("post", "telegram-unavailable");
    };

    const result = await participateInHackathon(input(), deps);

    expect(result).toEqual({
      kind: "postFailed",
      replyText: `Se creó el tema y se vinculó meridian, pero no se pudo publicar el análisis. Ejecuta /hackathon meridian dentro del tema: ${LINK(77)}`,
    });
    expect(row(deps).threadId).toBe(77);
  });

  it("returns linkFailed with the link when storing the link fails", async () => {
    const deps = setup({ create: [{ threadId: 77 }] });
    deps.hackathonAnalysisRepo.moveTopicLink = async () => {
      throw new Error("D1 unavailable");
    };

    const result = await participateInHackathon(input(), deps);

    expect(result).toEqual({
      kind: "linkFailed",
      replyText: `Se creó el tema, pero no se pudo vincular meridian. Ejecuta /hackathon meridian dentro del tema: ${LINK(77)}`,
    });
    expect(deps.chatPublisher.posted).toHaveLength(0);
    expect(deps.forumTopicManager.created).toHaveLength(1);
  });

  it("ignores a clearButtons failure and still confirms", async () => {
    const deps = setup({ row: { generalMessageId: 900 }, create: [{ threadId: 77 }] });
    deps.chatPublisher.clearButtons = async () => {
      throw new PublishFailedError("clear", "rejected");
    };

    const result = await participateInHackathon(input({ callbackMessageId: 901 }), deps);

    expect(result.kind).toBe("created");
    expect(row(deps).threadId).toBe(77);
  });

  it("clears the deduped set of callback and stored General message ids", async () => {
    const same = setup({ row: { generalMessageId: 900 }, create: [{ threadId: 77 }] });
    await participateInHackathon(input({ callbackMessageId: 900 }), same);
    expect(same.chatPublisher.cleared).toEqual([{ chatId: CHAT_ID, messageId: 900 }]);

    const other = setup({ row: { generalMessageId: 900 }, create: [{ threadId: 77 }] });
    await participateInHackathon(input({ callbackMessageId: 901 }), other);
    expect(other.chatPublisher.cleared).toEqual([
      { chatId: CHAT_ID, messageId: 901 },
      { chatId: CHAT_ID, messageId: 900 },
    ]);
  });

  it("works on an old analysis with a null generalMessageId and clears nothing for it", async () => {
    const deps = setup({ row: { generalMessageId: null }, create: [{ threadId: 77 }] });

    const result = await participateInHackathon(input(), deps);

    expect(result.kind).toBe("created");
    expect(deps.chatPublisher.cleared).toEqual([]);
  });
});
