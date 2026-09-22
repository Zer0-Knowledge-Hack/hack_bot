import { describe, expect, it } from "vitest";
import {
  canChangeRole,
  canEditProfile,
  isLastAdminDemotion,
} from "../../src/domain/access-policy";
import { asMemberId, asMembershipId, asTeamId } from "../../src/domain/ids";
import type { Membership } from "../../src/domain/entities";

const teamA = asTeamId("team-a");
const teamB = asTeamId("team-b");

function makeMembership(
  id: string,
  memberId: string,
  role: Membership["role"],
  teamId = teamA,
): Membership {
  return {
    id: asMembershipId(id),
    teamId,
    memberId: asMemberId(memberId),
    role,
    joinedAt: 0,
  };
}

describe("canEditProfile", () => {
  it("allows the owner to edit their own profile", () => {
    const owner = makeMembership("m1", "member-1", "member");
    expect(canEditProfile(owner, owner)).toBe(true);
  });

  it("allows an admin to edit a peer's profile in the same team", () => {
    const admin = makeMembership("m1", "member-1", "admin");
    const target = makeMembership("m2", "member-2", "member");
    expect(canEditProfile(admin, target)).toBe(true);
  });

  it("refuses a peer member editing another member's profile", () => {
    const actor = makeMembership("m1", "member-1", "member");
    const target = makeMembership("m2", "member-2", "member");
    expect(canEditProfile(actor, target)).toBe(false);
  });

  it("refuses cross-team edits even for an admin", () => {
    const admin = makeMembership("m1", "member-1", "admin", teamA);
    const target = makeMembership("m2", "member-2", "member", teamB);
    expect(canEditProfile(admin, target)).toBe(false);
  });
});

describe("canChangeRole", () => {
  it("allows an admin to change a same-team member's role", () => {
    const admin = makeMembership("m1", "member-1", "admin");
    const target = makeMembership("m2", "member-2", "member");
    expect(canChangeRole(admin, target)).toBe(true);
  });

  it("refuses a non-admin attempting a role change", () => {
    const actor = makeMembership("m1", "member-1", "member");
    const target = makeMembership("m2", "member-2", "member");
    expect(canChangeRole(actor, target)).toBe(false);
  });
});

describe("isLastAdminDemotion", () => {
  it("refuses demoting the only admin", () => {
    const target = makeMembership("m1", "member-1", "admin");
    expect(isLastAdminDemotion(target, "member", 1)).toBe(true);
  });

  it("allows demoting an admin when another admin remains", () => {
    const target = makeMembership("m1", "member-1", "admin");
    expect(isLastAdminDemotion(target, "member", 2)).toBe(false);
  });

  it("does not apply when the target is already a member", () => {
    const target = makeMembership("m1", "member-1", "member");
    expect(isLastAdminDemotion(target, "member", 1)).toBe(false);
  });
});
