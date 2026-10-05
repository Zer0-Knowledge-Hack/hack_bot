import { describe, expect, it } from "vitest";
import {
  AnalysisNotFoundError,
  NotFoundError,
  UnauthorizedError,
} from "../../../src/domain/errors";
import type { HackathonAnalysis } from "../../../src/domain/entities";
import { asMemberId, asMembershipId, asTeamId } from "../../../src/domain/ids";
import { unlinkHackathonFromTopic } from "../../../src/domain/usecases/unlink-hackathon-from-topic";
import {
  fakeChatPublisher,
  fakeForumTopicManager,
  fakeHackathonAnalysisRepo,
  fakeLogger,
  fakeMemberRepo,
  fakeMembershipRepo,
} from "../../fakes";

const teamId = asTeamId("team-1");
const CHAT_ID = 111;
const THREAD_ID = 500;

function makeDeps() {
  const memberRepo = fakeMemberRepo();
  return {
    membershipRepo: fakeMembershipRepo(memberRepo),
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
    threadId: THREAD_ID,
    pinnedMessageId: 42,
    generalMessageId: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("unlinkHackathonFromTopic", () => {
  it("clears the topic link, unpins, and closes the topic for an admin", async () => {
    const deps = makeDeps();
    const actorMembershipId = pushAdmin(deps);
    deps.hackathonAnalysisRepo.rows.push(analysis({ id: "a-1", slug: "meridian" }));

    const result = await unlinkHackathonFromTopic(
      { teamId, actorMembershipId, chatId: CHAT_ID, threadId: THREAD_ID },
      deps,
    );

    expect(result).toEqual({ slug: "meridian", topicClosed: true });
    expect(deps.hackathonAnalysisRepo.rows[0]?.threadId).toBeNull();
    expect(deps.hackathonAnalysisRepo.rows[0]?.pinnedMessageId).toBeNull();
    expect(deps.chatPublisher.unpinned).toEqual([42]);
    expect(deps.forumTopicManager.closed).toEqual([{ chatId: CHAT_ID, threadId: THREAD_ID }]);
  });

  it("unlinks by slug even when the caller is in a different thread", async () => {
    const deps = makeDeps();
    const actorMembershipId = pushAdmin(deps);
    deps.hackathonAnalysisRepo.rows.push(analysis({ id: "a-1", slug: "meridian" }));

    const result = await unlinkHackathonFromTopic(
      {
        teamId,
        actorMembershipId,
        chatId: CHAT_ID,
        threadId: 999,
        slug: "meridian",
      },
      deps,
    );

    expect(result.slug).toBe("meridian");
    expect(deps.forumTopicManager.closed).toEqual([{ chatId: CHAT_ID, threadId: THREAD_ID }]);
    expect(deps.hackathonAnalysisRepo.rows[0]?.threadId).toBeNull();
  });

  it("refuses a non-admin and leaves the link", async () => {
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
      unlinkHackathonFromTopic(
        { teamId, actorMembershipId: memberId, chatId: CHAT_ID, threadId: THREAD_ID },
        deps,
      ),
    ).rejects.toThrow(UnauthorizedError);
    expect(deps.hackathonAnalysisRepo.rows[0]?.threadId).toBe(THREAD_ID);
    expect(deps.forumTopicManager.closed).toEqual([]);
  });

  it("throws when the topic has no linked analysis", async () => {
    const deps = makeDeps();
    const actorMembershipId = pushAdmin(deps);

    await expect(
      unlinkHackathonFromTopic(
        { teamId, actorMembershipId, chatId: CHAT_ID, threadId: THREAD_ID },
        deps,
      ),
    ).rejects.toThrow(AnalysisNotFoundError);
  });

  it("rejects an unknown actor membership", async () => {
    const deps = makeDeps();
    deps.hackathonAnalysisRepo.rows.push(analysis({ id: "a-1", slug: "meridian" }));

    await expect(
      unlinkHackathonFromTopic(
        {
          teamId,
          actorMembershipId: asMembershipId("ghost"),
          chatId: CHAT_ID,
          threadId: THREAD_ID,
        },
        deps,
      ),
    ).rejects.toThrow(NotFoundError);
  });
});
