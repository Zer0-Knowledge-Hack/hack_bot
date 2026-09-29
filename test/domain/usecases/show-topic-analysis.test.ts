import { describe, expect, it } from "vitest";
import { showTopicAnalysis } from "../../../src/domain/usecases/show-topic-analysis";
import { NotFoundError } from "../../../src/domain/errors";
import type { HackathonAnalysis } from "../../../src/domain/entities";
import { asMemberId, asMembershipId, asTeamId } from "../../../src/domain/ids";
import { fakeHackathonAnalysisRepo, fakeMemberRepo, fakeMembershipRepo } from "../../fakes";

const teamId = asTeamId("team-1");
const memberId = asMembershipId("m-1");

function makeDeps() {
  const memberRepo = fakeMemberRepo();
  const membershipRepo = fakeMembershipRepo(memberRepo);
  membershipRepo.rows.push({
    id: memberId,
    teamId,
    memberId: asMemberId("u-1"),
    role: "member",
    joinedAt: 0,
  });
  return { membershipRepo, hackathonAnalysisRepo: fakeHackathonAnalysisRepo() };
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
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

// spec hackathon-analysis "No-Argument Behavior Depends on Topic Linking".
describe("showTopicAnalysis", () => {
  it("returns the analysis linked to the topic (any registered member)", async () => {
    const deps = makeDeps();
    deps.hackathonAnalysisRepo.rows.push(analysis({ id: "a-1", slug: "meridian", threadId: 500 }));
    deps.hackathonAnalysisRepo.rows.push(analysis({ id: "a-2", slug: "other", threadId: 600 }));

    const result = await showTopicAnalysis({ teamId, actorMembershipId: memberId, threadId: 500 }, deps);

    expect(result?.replyText).toContain("meridian");
    expect(result?.replyText).not.toContain("other");
  });

  it("returns null when the topic has no linked analysis", async () => {
    const deps = makeDeps();
    deps.hackathonAnalysisRepo.rows.push(analysis({ id: "a-1", slug: "meridian" }));

    const result = await showTopicAnalysis({ teamId, actorMembershipId: memberId, threadId: 500 }, deps);

    expect(result).toBeNull();
  });

  it("throws NotFoundError when the actor is not a registered member", async () => {
    const deps = makeDeps();
    deps.hackathonAnalysisRepo.rows.push(analysis({ id: "a-1", slug: "meridian", threadId: 500 }));

    await expect(
      showTopicAnalysis({ teamId, actorMembershipId: asMembershipId("ghost"), threadId: 500 }, deps),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
