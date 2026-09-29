import { describe, expect, it } from "vitest";
import { listAnalyses } from "../../../src/domain/usecases/list-analyses";
import { NotFoundError } from "../../../src/domain/errors";
import type { HackathonAnalysis } from "../../../src/domain/entities";
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

function analysis(overrides: Partial<HackathonAnalysis> & { id: string; slug: string }): HackathonAnalysis {
  return {
    teamId,
    sourceUrl: `https://example.com/${overrides.slug}`,
    normalizedUrl: `https://example.com/${overrides.slug}`,
    fields: {
      name: null,
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

describe("listAnalyses", () => {
  // spec hackathon-analysis "Listing within the limit".
  it("lists slug, name, deadline and linked status for any registered member", async () => {
    const deps = makeDeps();
    const actorMembershipId = pushMember(deps);
    deps.hackathonAnalysisRepo.rows.push(
      analysis({
        id: "a-1",
        slug: "meridian",
        fields: {
          name: { value: "Meridian Hacks", snippet: "", confidence: 0.9 },
          format: null,
          location: null,
          teamSize: null,
          submissionDeadline: { value: "2025-01-01", snippet: "", confidence: 0.9 },
          startDate: null,
          endDate: null,
          resultsDate: null,
          prizes: null,
          tracks: null,
          eligibility: null,
        },
        threadId: 500,
      }),
      analysis({ id: "a-2", slug: "unlinked-hack" }),
    );

    const result = await listAnalyses({ teamId, actorMembershipId }, deps);

    expect(result.replyText).toContain("meridian — Meridian Hacks — 2025-01-01 — vinculado");
    expect(result.replyText).toContain("unlinked-hack — (sin nombre) — sin fecha límite — no vinculado");
    expect(result.replyText.length).toBeLessThanOrEqual(4096);
  });

  // spec hackathon-analysis "Listing exceeds the limit".
  it("truncates the reply and appends a …y-N-más note past 4096 characters", async () => {
    const deps = makeDeps();
    const actorMembershipId = pushMember(deps);
    for (let i = 0; i < 100; i++) {
      deps.hackathonAnalysisRepo.rows.push(
        analysis({ id: `a-${i}`, slug: `hackathon-with-a-long-slug-name-${i}` }),
      );
    }

    const result = await listAnalyses({ teamId, actorMembershipId }, deps);

    expect(result.replyText.length).toBeLessThanOrEqual(4096);
    expect(result.replyText).toMatch(/…y \d+ más/);
  });

  it("throws NotFoundError when the actor is not a registered member", async () => {
    const deps = makeDeps();

    await expect(
      listAnalyses({ teamId, actorMembershipId: asMembershipId("ghost") }, deps),
    ).rejects.toThrow(NotFoundError);
  });
});
