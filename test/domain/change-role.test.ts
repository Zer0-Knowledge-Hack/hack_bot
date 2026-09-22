import { describe, expect, it } from "vitest";
import { changeRole } from "../../src/domain/usecases/change-role";
import { LastAdminError, UnauthorizedError } from "../../src/domain/errors";
import { asMemberId, asMembershipId, asTeamId } from "../../src/domain/ids";
import type { MembershipId } from "../../src/domain/ids";
import { fakeMemberRepo, fakeMembershipRepo } from "../fakes";

const teamId = asTeamId("team-1");

function makeDeps() {
  const memberRepo = fakeMemberRepo();
  const membershipRepo = fakeMembershipRepo(memberRepo);
  return { membershipRepo };
}

describe("changeRole", () => {
  it("lets an admin promote a member", async () => {
    const { membershipRepo } = makeDeps();
    const adminId = asMembershipId("m-admin");
    const memberId = asMembershipId("m-member");
    membershipRepo.rows.push(
      { id: adminId, teamId, memberId: asMemberId("u-admin"), role: "admin", joinedAt: 0 },
      { id: memberId, teamId, memberId: asMemberId("u-member"), role: "member", joinedAt: 0 },
    );

    await changeRole(
      { teamId, actorMembershipId: adminId, targetMembershipId: memberId, newRole: "admin" },
      { membershipRepo },
    );

    expect(membershipRepo.rows.find((m) => m.id === memberId)?.role).toBe("admin");
  });

  it("REL-001: records the acting admin as actor and the edited member as target (admin edits another member)", async () => {
    const { membershipRepo } = makeDeps();
    const adminId = asMembershipId("m-admin");
    const memberId = asMembershipId("m-member");
    membershipRepo.rows.push(
      { id: adminId, teamId, memberId: asMemberId("u-admin"), role: "admin", joinedAt: 0 },
      { id: memberId, teamId, memberId: asMemberId("u-member"), role: "member", joinedAt: 0 },
    );

    await changeRole(
      { teamId, actorMembershipId: adminId, targetMembershipId: memberId, newRole: "admin" },
      { membershipRepo },
    );

    expect(membershipRepo.audits).toHaveLength(1);
    expect(membershipRepo.audits[0]?.actorMembershipId).toBe(adminId);
    expect(membershipRepo.audits[0]?.targetMembershipId).toBe(memberId);
  });

  it("refuses when the caller is not an admin", async () => {
    const { membershipRepo } = makeDeps();
    const actorId = asMembershipId("m-peer");
    const targetId = asMembershipId("m-target");
    membershipRepo.rows.push(
      { id: actorId, teamId, memberId: asMemberId("u-peer"), role: "member", joinedAt: 0 },
      { id: targetId, teamId, memberId: asMemberId("u-target"), role: "member", joinedAt: 0 },
    );

    await expect(
      changeRole(
        { teamId, actorMembershipId: actorId, targetMembershipId: targetId, newRole: "admin" },
        { membershipRepo },
      ),
    ).rejects.toThrow(UnauthorizedError);
    expect(membershipRepo.rows.find((m) => m.id === targetId)?.role).toBe("member");
  });

  it("refuses demoting the last remaining admin", async () => {
    const { membershipRepo } = makeDeps();
    const adminId = asMembershipId("m-admin");
    membershipRepo.rows.push({
      id: adminId,
      teamId,
      memberId: asMemberId("u-admin"),
      role: "admin",
      joinedAt: 0,
    });

    await expect(
      changeRole(
        { teamId, actorMembershipId: adminId, targetMembershipId: adminId, newRole: "member" },
        { membershipRepo },
      ),
    ).rejects.toThrow(LastAdminError);
    expect(membershipRepo.rows.find((m) => m.id === adminId)?.role).toBe("admin");
  });

  it("keeps at least one admin when two demotions race past the friendly pre-check", async () => {
    const { membershipRepo } = makeDeps();
    const admin1 = asMembershipId("m-admin-1");
    const admin2 = asMembershipId("m-admin-2");
    membershipRepo.rows.push(
      { id: admin1, teamId, memberId: asMemberId("u-1"), role: "admin", joinedAt: 0 },
      { id: admin2, teamId, memberId: asMemberId("u-2"), role: "admin", joinedAt: 0 },
    );

    // Both calls pass the pre-check (listByTeam) while adminCount is still 2,
    // then interleave at the write step — the port's atomic precondition
    // MUST allow only one of the two demotions to succeed.
    const outcomes = await Promise.allSettled([
      changeRole(
        { teamId, actorMembershipId: admin1, targetMembershipId: admin1, newRole: "member" },
        { membershipRepo },
      ),
      changeRole(
        { teamId, actorMembershipId: admin2, targetMembershipId: admin2, newRole: "member" },
        { membershipRepo },
      ),
    ]);

    const remainingAdmins = membershipRepo.rows.filter((m) => m.role === "admin");
    expect(remainingAdmins).toHaveLength(1);
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((o) => o.status === "rejected")).toHaveLength(1);
    const rejected = outcomes.find((o) => o.status === "rejected");
    expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(LastAdminError);
  });

  it("enforces the last-admin invariant atomically at the port, even when both writers already saw adminCount=2 in their pre-read", async () => {
    const { membershipRepo } = makeDeps();
    const admin1 = asMembershipId("m-admin-1");
    const admin2 = asMembershipId("m-admin-2");
    membershipRepo.rows.push(
      { id: admin1, teamId, memberId: asMemberId("u-1"), role: "admin", joinedAt: 0 },
      { id: admin2, teamId, memberId: asMemberId("u-2"), role: "admin", joinedAt: 0 },
    );

    // Simulate two transactions that both completed their pre-read (both
    // observe adminCount = 2, so a naive pre-check would let both proceed)
    // BEFORE either write is issued.
    const preReadAdminCount = (await membershipRepo.listByTeam(teamId)).filter(
      (m) => m.role === "admin",
    ).length;
    expect(preReadAdminCount).toBe(2);

    const draftFor = (target: MembershipId, oldValue: string) => ({
      field: "role",
      oldValue,
      newValue: "member",
      keyVersion: null,
    });

    const [result1, result2] = await Promise.all([
      membershipRepo.changeRole(teamId, admin1, "member", admin1, draftFor(admin1, "admin"), {
        requireRemainingAdmin: true,
      }),
      membershipRepo.changeRole(teamId, admin2, "member", admin2, draftFor(admin2, "admin"), {
        requireRemainingAdmin: true,
      }),
    ]);

    const remainingAdmins = membershipRepo.rows.filter((m) => m.role === "admin");
    expect(remainingAdmins).toHaveLength(1);
    expect([result1.applied, result2.applied].filter(Boolean)).toHaveLength(1);
    expect([result1.applied, result2.applied].filter((applied) => !applied)).toHaveLength(1);
  });
});
