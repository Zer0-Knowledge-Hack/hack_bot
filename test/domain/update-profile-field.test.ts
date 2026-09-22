import { describe, expect, it } from "vitest";
import { updateProfileField } from "../../src/domain/usecases/update-profile-field";
import { UnauthorizedError } from "../../src/domain/errors";
import { asMemberId, asMembershipId, asTeamId } from "../../src/domain/ids";
import { fakeClock, fakeMemberRepo, fakeMembershipRepo, fakeProfileRepo } from "../fakes";

const teamId = asTeamId("team-1");

function makeDeps() {
  const memberRepo = fakeMemberRepo();
  const membershipRepo = fakeMembershipRepo(memberRepo);
  const profileRepo = fakeProfileRepo();
  const clock = fakeClock();
  return { membershipRepo, profileRepo, clock };
}

describe("updateProfileField", () => {
  it("applies a single field edit and records one audit entry", async () => {
    const deps = makeDeps();
    const ownerId = asMembershipId("m-owner");
    deps.membershipRepo.rows.push({
      id: ownerId,
      teamId,
      memberId: asMemberId("u-owner"),
      role: "member",
      joinedAt: 0,
    });

    await updateProfileField(
      {
        teamId,
        actorMembershipId: ownerId,
        targetMembershipId: ownerId,
        field: "github_username",
        value: "octocat",
        keyVersion: null,
      },
      deps,
    );

    expect(deps.profileRepo.rows).toHaveLength(1);
    expect(deps.profileRepo.rows[0]?.value).toBe("octocat");
    expect(deps.profileRepo.audits).toHaveLength(1);
  });

  it("refuses a peer editing another member's profile and writes no audit row", async () => {
    const deps = makeDeps();
    const actorId = asMembershipId("m-peer");
    const targetId = asMembershipId("m-target");
    deps.membershipRepo.rows.push(
      { id: actorId, teamId, memberId: asMemberId("u-peer"), role: "member", joinedAt: 0 },
      { id: targetId, teamId, memberId: asMemberId("u-target"), role: "member", joinedAt: 0 },
    );

    await expect(
      updateProfileField(
        {
          teamId,
          actorMembershipId: actorId,
          targetMembershipId: targetId,
          field: "github_username",
          value: "hacker",
          keyVersion: null,
        },
        deps,
      ),
    ).rejects.toThrow(UnauthorizedError);
    expect(deps.profileRepo.rows).toHaveLength(0);
    expect(deps.profileRepo.audits).toHaveLength(0);
  });
});
