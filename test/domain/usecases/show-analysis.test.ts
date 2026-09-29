import { describe, expect, it } from "vitest";
import { showAnalysis } from "../../../src/domain/usecases/show-analysis";
import { AnalysisNotFoundError, NotFoundError } from "../../../src/domain/errors";
import { asMemberId, asMembershipId, asTeamId } from "../../../src/domain/ids";
import {
  fakeHackathonAnalysisRepo,
  fakeMemberRepo,
  fakeMembershipRepo,
} from "../../fakes";

const teamId = asTeamId("team-1");

function makeDeps() {
  const memberRepo = fakeMemberRepo();
  const membershipRepo = fakeMembershipRepo(memberRepo);
  return {
    membershipRepo,
    hackathonAnalysisRepo: fakeHackathonAnalysisRepo(),
  };
}

function pushMember(deps: ReturnType<typeof makeDeps>) {
  const memberId = asMembershipId("m-member");
  deps.membershipRepo.rows.push({
    id: memberId,
    teamId,
    memberId: asMemberId("u-member"),
    role: "member",
    joinedAt: 0,
  });
  return memberId;
}

describe("showAnalysis", () => {
  // spec hackathon-analysis "Member re-shows an existing slug": any
  // registered member (not just an admin) can re-show a stored analysis,
  // and it never touches AnalysisQuota (no such dependency exists here).
  it("replies with the stored analysis for any registered member", async () => {
    const deps = makeDeps();
    const actorMembershipId = pushMember(deps);
    deps.hackathonAnalysisRepo.rows.push({
      id: "analysis-1",
      teamId,
      slug: "meridian",
      sourceUrl: "https://example.com/event",
      normalizedUrl: "https://example.com/event",
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
    });

    const result = await showAnalysis(
      { teamId, actorMembershipId, slug: "meridian" },
      deps,
    );

    expect(result.replyText).toContain("Slug: meridian");
    expect(result.replyText).toContain("Meridian");
  });

  it("throws AnalysisNotFoundError when the slug has no stored analysis", async () => {
    const deps = makeDeps();
    const actorMembershipId = pushMember(deps);

    await expect(
      showAnalysis({ teamId, actorMembershipId, slug: "missing" }, deps),
    ).rejects.toThrow(AnalysisNotFoundError);
  });

  it("throws NotFoundError when the actor is not a registered member", async () => {
    const deps = makeDeps();

    await expect(
      showAnalysis(
        { teamId, actorMembershipId: asMembershipId("ghost"), slug: "meridian" },
        deps,
      ),
    ).rejects.toThrow(NotFoundError);
  });
});
