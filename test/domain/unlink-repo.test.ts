import { describe, expect, it } from "vitest";
import { unlinkRepo } from "../../src/domain/usecases/unlink-repo";
import { NotFoundError, UnauthorizedError } from "../../src/domain/errors";
import { parseRepoFullName } from "../../src/domain/github";
import { asMemberId, asMembershipId, asTeamId } from "../../src/domain/ids";
import {
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
    repoTopicLinkRepo: fakeRepoTopicLinkRepo(),
  };
}

describe("unlinkRepo", () => {
  it("rejects a caller who is not a registered member", async () => {
    const deps = makeDeps();
    deps.repoTopicLinkRepo.rows.push({
      teamId,
      repoFullName: repo,
      orgLogin: "octocat",
      threadId: 10,
      createdAt: 0,
      updatedAt: 0,
    });

    await expect(
      unlinkRepo({ teamId, actorMembershipId: asMembershipId("ghost"), repo }, deps),
    ).rejects.toThrow(NotFoundError);
    expect(deps.repoTopicLinkRepo.rows).toHaveLength(1);
  });

  it("lets a team admin remove an existing link", async () => {
    const deps = makeDeps();
    const adminId = asMembershipId("m-admin");
    deps.membershipRepo.rows.push({
      id: adminId,
      teamId,
      memberId: asMemberId("u-admin"),
      role: "admin",
      joinedAt: 0,
    });
    deps.repoTopicLinkRepo.rows.push({
      teamId,
      repoFullName: repo,
      orgLogin: "octocat",
      threadId: 10,
      createdAt: 0,
      updatedAt: 0,
    });

    const removed = await unlinkRepo({ teamId, actorMembershipId: adminId, repo }, deps);

    expect(removed).toBe(true);
    expect(deps.repoTopicLinkRepo.rows).toHaveLength(0);
  });

  it("refuses a non-admin and leaves the link in place", async () => {
    const deps = makeDeps();
    const memberId = asMembershipId("m-member");
    deps.membershipRepo.rows.push({
      id: memberId,
      teamId,
      memberId: asMemberId("u-member"),
      role: "member",
      joinedAt: 0,
    });
    deps.repoTopicLinkRepo.rows.push({
      teamId,
      repoFullName: repo,
      orgLogin: "octocat",
      threadId: 10,
      createdAt: 0,
      updatedAt: 0,
    });

    await expect(
      unlinkRepo({ teamId, actorMembershipId: memberId, repo }, deps),
    ).rejects.toThrow(UnauthorizedError);
    expect(deps.repoTopicLinkRepo.rows).toHaveLength(1);
  });

  it("returns false when there is no link to remove", async () => {
    const deps = makeDeps();
    const adminId = asMembershipId("m-admin");
    deps.membershipRepo.rows.push({
      id: adminId,
      teamId,
      memberId: asMemberId("u-admin"),
      role: "admin",
      joinedAt: 0,
    });

    const removed = await unlinkRepo({ teamId, actorMembershipId: adminId, repo }, deps);

    expect(removed).toBe(false);
  });
});
