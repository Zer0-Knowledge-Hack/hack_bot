import { describe, expect, it } from "vitest";
import { listRepoLinks } from "../../src/domain/usecases/list-repo-links";
import { NotFoundError } from "../../src/domain/errors";
import { parseRepoFullName } from "../../src/domain/github";
import { asMemberId, asMembershipId, asTeamId } from "../../src/domain/ids";
import {
  fakeGithubOrgClaimRepo,
  fakeMemberRepo,
  fakeMembershipRepo,
  fakeRepoTopicLinkRepo,
} from "../fakes";

const teamId = asTeamId("team-1");
const repoA = parseRepoFullName("octocat/repo-a")!;
const repoB = parseRepoFullName("octocat/repo-b")!;

function makeDeps() {
  const memberRepo = fakeMemberRepo();
  return {
    membershipRepo: fakeMembershipRepo(memberRepo),
    repoTopicLinkRepo: fakeRepoTopicLinkRepo(),
    githubOrgClaimRepo: fakeGithubOrgClaimRepo(),
  };
}

describe("listRepoLinks", () => {
  it("lets a non-admin member list the team's links", async () => {
    const deps = makeDeps();
    const memberId = asMembershipId("m-member");
    deps.membershipRepo.rows.push({
      id: memberId,
      teamId,
      memberId: asMemberId("u-member"),
      role: "member",
      joinedAt: 0,
    });
    deps.githubOrgClaimRepo.rows.push({ teamId, orgLogin: "octocat" });
    deps.repoTopicLinkRepo.rows.push(
      { teamId, repoFullName: repoA, orgLogin: "octocat", threadId: 1, createdAt: 0, updatedAt: 0 },
      { teamId, repoFullName: repoB, orgLogin: "octocat", threadId: 2, createdAt: 0, updatedAt: 0 },
    );

    const links = await listRepoLinks({ teamId, actorMembershipId: memberId }, deps);

    expect(links.map((l) => l.repoFullName).sort()).toEqual([repoA, repoB].sort());
  });

  it("refuses a caller who is not a registered member", async () => {
    const deps = makeDeps();

    await expect(
      listRepoLinks({ teamId, actorMembershipId: asMembershipId("ghost") }, deps),
    ).rejects.toThrow(NotFoundError);
  });

  it("excludes a link whose org claim no longer exists", async () => {
    const deps = makeDeps();
    const memberId = asMembershipId("m-member");
    deps.membershipRepo.rows.push({
      id: memberId,
      teamId,
      memberId: asMemberId("u-member"),
      role: "member",
      joinedAt: 0,
    });
    // No claim row pushed for "octocat" — the link is stale.
    deps.repoTopicLinkRepo.rows.push({
      teamId,
      repoFullName: repoA,
      orgLogin: "octocat",
      threadId: 1,
      createdAt: 0,
      updatedAt: 0,
    });

    const links = await listRepoLinks({ teamId, actorMembershipId: memberId }, deps);

    expect(links).toHaveLength(0);
  });
});
