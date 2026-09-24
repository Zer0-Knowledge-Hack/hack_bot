import { describe, expect, it } from "vitest";
import { linkRepoToTopic } from "../../src/domain/usecases/link-repo-to-topic";
import { NotFoundError, OrgNotClaimedError, UnauthorizedError } from "../../src/domain/errors";
import { parseRepoFullName } from "../../src/domain/github";
import { asMemberId, asMembershipId, asTeamId } from "../../src/domain/ids";
import {
  fakeClock,
  fakeGithubOrgClaimRepo,
  fakeMemberRepo,
  fakeMembershipRepo,
  fakeRepoTopicLinkRepo,
} from "../fakes";

const teamId = asTeamId("team-1");
const repo = parseRepoFullName("octocat/hello-world")!;

function makeDeps() {
  const memberRepo = fakeMemberRepo();
  return {
    membershipRepo: fakeMembershipRepo(memberRepo),
    githubOrgClaimRepo: fakeGithubOrgClaimRepo(),
    repoTopicLinkRepo: fakeRepoTopicLinkRepo(),
    clock: fakeClock(),
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

describe("linkRepoToTopic", () => {
  it("rejects a caller who is not a registered member", async () => {
    const deps = makeDeps();
    deps.githubOrgClaimRepo.rows.push({ teamId, orgLogin: "octocat" });

    await expect(
      linkRepoToTopic(
        { teamId, actorMembershipId: asMembershipId("ghost"), repo, threadId: 10 },
        deps,
      ),
    ).rejects.toThrow(NotFoundError);
    expect(deps.repoTopicLinkRepo.rows).toHaveLength(0);
  });

  it("links a repo whose org is claimed by the team", async () => {
    const deps = makeDeps();
    const adminId = pushAdmin(deps);
    deps.githubOrgClaimRepo.rows.push({ teamId, orgLogin: "octocat" });

    const result = await linkRepoToTopic(
      { teamId, actorMembershipId: adminId, repo, threadId: 10 },
      deps,
    );

    expect(result).toEqual({ repo, previousThreadId: null });
    expect(deps.repoTopicLinkRepo.rows).toEqual([
      {
        teamId,
        repoFullName: repo,
        orgLogin: "octocat",
        threadId: 10,
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
      },
    ]);
  });

  it("rejects linking a repo whose org has no claim, and stores no row", async () => {
    const deps = makeDeps();
    const adminId = pushAdmin(deps);

    await expect(
      linkRepoToTopic({ teamId, actorMembershipId: adminId, repo, threadId: 10 }, deps),
    ).rejects.toThrow(OrgNotClaimedError);
    expect(deps.repoTopicLinkRepo.rows).toHaveLength(0);
  });

  it("refuses a non-admin", async () => {
    const deps = makeDeps();
    const memberId = pushMember(deps);
    deps.githubOrgClaimRepo.rows.push({ teamId, orgLogin: "octocat" });

    await expect(
      linkRepoToTopic({ teamId, actorMembershipId: memberId, repo, threadId: 10 }, deps),
    ).rejects.toThrow(UnauthorizedError);
    expect(deps.repoTopicLinkRepo.rows).toHaveLength(0);
  });

  it("re-linking an already-linked repo moves it and reports the previous thread id", async () => {
    const deps = makeDeps();
    const adminId = pushAdmin(deps);
    deps.githubOrgClaimRepo.rows.push({ teamId, orgLogin: "octocat" });

    await linkRepoToTopic({ teamId, actorMembershipId: adminId, repo, threadId: 10 }, deps);
    deps.clock.advance(1_000);
    const result = await linkRepoToTopic(
      { teamId, actorMembershipId: adminId, repo, threadId: 20 },
      deps,
    );

    expect(result).toEqual({ repo, previousThreadId: 10 });
    expect(deps.repoTopicLinkRepo.rows).toHaveLength(1);
    expect(deps.repoTopicLinkRepo.rows[0]?.threadId).toBe(20);
  });
});
