import { describe, expect, it } from "vitest";
import {
  linkAnalysisToTopic,
  postAnalysisAndLinkTopic,
} from "../../../src/domain/usecases/link-analysis-to-topic";
import { REPLY_MAX } from "../../../src/domain/hackathon/format";
import {
  AnalysisNotFoundError,
  NotFoundError,
  UnauthorizedError,
} from "../../../src/domain/errors";
import type { HackathonAnalysis } from "../../../src/domain/entities";
import { asMemberId, asMembershipId, asTeamId } from "../../../src/domain/ids";
import {
  fakeChatPublisher,
  fakeForumTopicManager,
  fakeHackathonAnalysisRepo,
  fakeLogger,
  fakeMemberRepo,
  fakeMembershipRepo,
  fakeSleep,
} from "../../fakes";

const teamId = asTeamId("team-1");
const CHAT_ID = 111;

function makeDeps() {
  const memberRepo = fakeMemberRepo();
  const membershipRepo = fakeMembershipRepo(memberRepo);
  return {
    membershipRepo,
    hackathonAnalysisRepo: fakeHackathonAnalysisRepo(),
    chatPublisher: fakeChatPublisher(),
    forumTopicManager: fakeForumTopicManager(),
    logger: fakeLogger(),
  };
}

function pushAdmin(deps: ReturnType<typeof makeDeps>) {
  const adminId = asMembershipId("m-admin");
  deps.membershipRepo.rows.push({
    id: adminId,
    teamId,
    memberId: asMemberId("u-admin"),
    role: "admin",
    joinedAt: 0,
  });
  return adminId;
}

function analysis(overrides: Partial<HackathonAnalysis> & { id: string; slug: string }): HackathonAnalysis {
  return {
    teamId,
    sourceUrl: `https://example.com/${overrides.slug}`,
    normalizedUrl: `https://example.com/${overrides.slug}`,
    fields: {
      name: { value: overrides.slug, snippet: "", confidence: 0.9 },
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

describe("linkAnalysisToTopic", () => {
  // spec hackathon-analysis "Linking into an empty topic".
  it("links and pins the analysis when the topic has no existing link", async () => {
    const deps = makeDeps();
    const actorMembershipId = pushAdmin(deps);
    deps.hackathonAnalysisRepo.rows.push(analysis({ id: "a-1", slug: "meridian" }));

    const result = await linkAnalysisToTopic(
      { teamId, actorMembershipId, chatId: CHAT_ID, threadId: 500, slug: "meridian" },
      deps,
    );

    expect(deps.chatPublisher.posted).toHaveLength(1);
    expect(deps.chatPublisher.posted[0]).toMatchObject({ chatId: CHAT_ID, threadId: 500 });
    expect(deps.chatPublisher.pinned).toEqual([1]);
    const stored = deps.hackathonAnalysisRepo.rows.find((r) => r.id === "a-1");
    expect(stored?.threadId).toBe(500);
    expect(stored?.pinnedMessageId).toBe(1);
    expect(result.replyText).toContain("meridian");
    // The analysis itself is the pinned post, so a clean link has no notes.
    expect(result.notes).toEqual([]);
  });

  // spec hackathon-analysis "Topic already holds a different analysis".
  it("unpins the old message and moves the link when the topic already holds a different analysis", async () => {
    const deps = makeDeps();
    const actorMembershipId = pushAdmin(deps);
    deps.hackathonAnalysisRepo.rows.push(
      analysis({ id: "a-alpha", slug: "alpha", threadId: 500, pinnedMessageId: 900 }),
    );
    deps.hackathonAnalysisRepo.rows.push(analysis({ id: "a-beta", slug: "beta" }));

    const result = await linkAnalysisToTopic(
      { teamId, actorMembershipId, chatId: CHAT_ID, threadId: 500, slug: "beta" },
      deps,
    );

    expect(deps.chatPublisher.unpinned).toEqual([900]);
    const alpha = deps.hackathonAnalysisRepo.rows.find((r) => r.id === "a-alpha");
    expect(alpha?.threadId).toBeNull();
    expect(alpha?.pinnedMessageId).toBeNull();
    const beta = deps.hackathonAnalysisRepo.rows.find((r) => r.id === "a-beta");
    expect(beta?.threadId).toBe(500);
    expect(beta?.pinnedMessageId).not.toBeNull();
    expect(result.replyText).toContain("Se reemplazó");
    expect(result.notes).toEqual(["Se reemplazó el vínculo anterior del tema (era alpha)."]);
  });

  // spec hackathon-analysis "Analysis already linked to another topic".
  it("unpins the old message and moves the link when the analysis is already linked elsewhere", async () => {
    const deps = makeDeps();
    const actorMembershipId = pushAdmin(deps);
    deps.hackathonAnalysisRepo.rows.push(
      analysis({ id: "a-alpha", slug: "alpha", threadId: 500, pinnedMessageId: 900 }),
    );

    const result = await linkAnalysisToTopic(
      { teamId, actorMembershipId, chatId: CHAT_ID, threadId: 600, slug: "alpha" },
      deps,
    );

    expect(deps.chatPublisher.unpinned).toEqual([900]);
    const alpha = deps.hackathonAnalysisRepo.rows.find((r) => r.id === "a-alpha");
    expect(alpha?.threadId).toBe(600);
    expect(alpha?.pinnedMessageId).not.toBeNull();
    expect(result.replyText).toContain("Se movió");
    expect(result.notes).toEqual(["Se movió el vínculo de este análisis desde otro tema."]);
  });

  // READ-001: notes appended after a maximal-length analysis body must not
  // push the reply over Telegram's REPLY_MAX — the analysis body is
  // truncated to make room, never the notes.
  it("truncates the analysis body, not the notes, to keep the reply within REPLY_MAX (READ-001)", async () => {
    const deps = makeDeps();
    const actorMembershipId = pushAdmin(deps);
    deps.hackathonAnalysisRepo.rows.push(
      analysis({ id: "a-alpha", slug: "alpha", threadId: 500, pinnedMessageId: 900 }),
    );
    const maximalAnalysis = analysis({ id: "a-beta", slug: "beta" });
    maximalAnalysis.fields = {
      ...maximalAnalysis.fields,
      name: { value: "x".repeat(6000), snippet: "", confidence: 0.9 },
    };
    deps.hackathonAnalysisRepo.rows.push(maximalAnalysis);

    const result = await linkAnalysisToTopic(
      { teamId, actorMembershipId, chatId: CHAT_ID, threadId: 500, slug: "beta" },
      deps,
    );

    expect(result.replyText.length).toBeLessThanOrEqual(REPLY_MAX);
    expect(result.replyText).toContain("Se reemplazó");
  });

  // spec hackathon-analysis "Pin Failure Falls Back to Unpinned Posting".
  it("posts unpinned and states the pin failure when pin() throws", async () => {
    const deps = makeDeps();
    const actorMembershipId = pushAdmin(deps);
    deps.hackathonAnalysisRepo.rows.push(analysis({ id: "a-1", slug: "meridian" }));
    deps.chatPublisher.pin = async () => {
      throw new Error("bot lacks pin rights");
    };

    const result = await linkAnalysisToTopic(
      { teamId, actorMembershipId, chatId: CHAT_ID, threadId: 500, slug: "meridian" },
      deps,
    );

    expect(deps.chatPublisher.posted).toHaveLength(1);
    const stored = deps.hackathonAnalysisRepo.rows.find((r) => r.id === "a-1");
    expect(stored?.threadId).toBe(500);
    expect(stored?.pinnedMessageId).toBeNull();
    expect(result.replyText).toContain("fijar");
    expect(result.notes).toEqual(["No se pudo fijar el mensaje; se publicó sin fijar."]);
    expect(deps.logger.entries).toHaveLength(1);
    expect(deps.logger.entries[0]).toMatchObject({
      outcome: "error",
      errorCode: "Error",
      reason: "pin-failed",
    });
  });

  it("throws AnalysisNotFoundError when the slug has no stored analysis", async () => {
    const deps = makeDeps();
    const actorMembershipId = pushAdmin(deps);

    await expect(
      linkAnalysisToTopic(
        { teamId, actorMembershipId, chatId: CHAT_ID, threadId: 500, slug: "missing" },
        deps,
      ),
    ).rejects.toThrow(AnalysisNotFoundError);
  });

  it("throws UnauthorizedError for a non-admin", async () => {
    const deps = makeDeps();
    const memberId = asMembershipId("m-member");
    deps.membershipRepo.rows.push({
      id: memberId,
      teamId,
      memberId: asMemberId("u-member"),
      role: "member",
      joinedAt: 0,
    });
    deps.hackathonAnalysisRepo.rows.push(analysis({ id: "a-1", slug: "meridian" }));

    await expect(
      linkAnalysisToTopic(
        { teamId, actorMembershipId: memberId, chatId: CHAT_ID, threadId: 500, slug: "meridian" },
        deps,
      ),
    ).rejects.toThrow(UnauthorizedError);
  });

  it("throws NotFoundError when the actor is not a registered member", async () => {
    const deps = makeDeps();
    deps.hackathonAnalysisRepo.rows.push(analysis({ id: "a-1", slug: "meridian" }));

    await expect(
      linkAnalysisToTopic(
        {
          teamId,
          actorMembershipId: asMembershipId("ghost"),
          chatId: CHAT_ID,
          threadId: 500,
          slug: "meridian",
        },
        deps,
      ),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("postAnalysisAndLinkTopic: pin delay", () => {
  const row = () => analysis({ id: "a-pin", slug: "pin" });

  it("waits pinDelayMs between the post and the pin when asked", async () => {
    const deps = makeDeps();
    const events: string[] = [];
    const realPost = deps.chatPublisher.post;
    const realPin = deps.chatPublisher.pin;
    deps.chatPublisher.post = async (...args) => {
      events.push("post");
      return realPost(...args);
    };
    deps.chatPublisher.pin = async (...args) => {
      events.push("pin");
      return realPin(...args);
    };
    const sleep = fakeSleep((ms) => events.push(`sleep:${ms}`));
    deps.hackathonAnalysisRepo.rows.push(row());

    await postAnalysisAndLinkTopic(
      { teamId, chatId: 10, threadId: 5, analysis: row(), pinDelayMs: 750 },
      { ...deps, sleep },
    );

    expect(events).toEqual(["post", "sleep:750", "pin"]);
  });

  it("never sleeps without pinDelayMs, even when a sleep dep is present", async () => {
    const deps = makeDeps();
    const sleep = fakeSleep();
    deps.hackathonAnalysisRepo.rows.push(row());

    await postAnalysisAndLinkTopic(
      { teamId, chatId: 10, threadId: 5, analysis: row() },
      { ...deps, sleep },
    );

    expect(sleep.calls).toEqual([]);
    expect(deps.chatPublisher.pinned).toHaveLength(1);
  });

  it("works with no sleep dep at all (existing callers)", async () => {
    const deps = makeDeps();
    deps.hackathonAnalysisRepo.rows.push(row());

    await postAnalysisAndLinkTopic({ teamId, chatId: 10, threadId: 5, analysis: row() }, deps);

    expect(deps.chatPublisher.pinned).toHaveLength(1);
  });
});
