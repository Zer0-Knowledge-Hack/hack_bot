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
    expect(deps.profileRepo.audits[0]?.actorMembershipId).toBe(ownerId);
    expect(deps.profileRepo.audits[0]?.targetMembershipId).toBe(ownerId);
  });

  it("REL-001: records the acting admin as actor and the edited member as target (admin edits another member's profile)", async () => {
    const deps = makeDeps();
    const adminId = asMembershipId("m-admin");
    const targetId = asMembershipId("m-target");
    deps.membershipRepo.rows.push(
      { id: adminId, teamId, memberId: asMemberId("u-admin"), role: "admin", joinedAt: 0 },
      { id: targetId, teamId, memberId: asMemberId("u-target"), role: "member", joinedAt: 0 },
    );

    await updateProfileField(
      {
        teamId,
        actorMembershipId: adminId,
        targetMembershipId: targetId,
        field: "github_username",
        value: "octocat",
        keyVersion: null,
      },
      deps,
    );

    expect(deps.profileRepo.audits).toHaveLength(1);
    expect(deps.profileRepo.audits[0]?.actorMembershipId).toBe(adminId);
    expect(deps.profileRepo.audits[0]?.targetMembershipId).toBe(targetId);
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

  it("FIX-001: never fabricates an oldValue when the existing field is unreadable", async () => {
    const deps = makeDeps();
    const ownerId = asMembershipId("m-owner-2");
    deps.membershipRepo.rows.push({
      id: ownerId,
      teamId,
      memberId: asMemberId("u-owner-2"),
      role: "member",
      joinedAt: 0,
    });
    // Simulates a field whose stored ciphertext could not be decrypted
    // (RES-001) — value is "" and unreadable:true, never real plaintext.
    deps.profileRepo.rows.push({
      teamId,
      membershipId: ownerId,
      field: "full_name",
      value: "",
      keyVersion: 99,
      updatedAt: 0,
      unreadable: true,
    });

    await updateProfileField(
      {
        teamId,
        actorMembershipId: ownerId,
        targetMembershipId: ownerId,
        field: "full_name",
        value: "Ada Lovelace",
        keyVersion: null,
      },
      deps,
    );

    expect(deps.profileRepo.audits).toHaveLength(1);
    // Must never fabricate "" (the placeholder for an unreadable field) as
    // if it were the real prior plaintext.
    expect(deps.profileRepo.audits[0]?.oldValue).not.toBe("");
    expect(deps.profileRepo.audits[0]?.oldValue).toBeNull();
    expect(deps.profileRepo.audits[0]?.oldValueUnreadable).toBe(true);
  });
});
