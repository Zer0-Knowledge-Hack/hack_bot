import { describe, expect, it } from "vitest";
import { resolveDmTeam, selectDmTeam } from "../../src/domain/usecases/dm-team-selection";
import { UnauthorizedError } from "../../src/domain/errors";
import { asMemberId, asMembershipId, asTeamId } from "../../src/domain/ids";
import { fakeClock, fakeDmSelectionRepo, fakeMemberRepo, fakeMembershipRepo } from "../fakes";

const teamA = asTeamId("team-a");
const teamB = asTeamId("team-b");
const teamC = asTeamId("team-c");
const telegramUserId = 7;

function makeDeps() {
  const memberRepo = fakeMemberRepo();
  memberRepo.rows.push({ id: asMemberId("u-1"), telegramUserId, createdAt: 0 });
  return {
    memberRepo,
    membershipRepo: fakeMembershipRepo(memberRepo),
    dmSelectionRepo: fakeDmSelectionRepo(),
    clock: fakeClock(),
  };
}

describe("resolveDmTeam", () => {
  it("reports no teams when the caller has zero memberships", async () => {
    const deps = makeDeps();
    const result = await resolveDmTeam({ telegramUserId }, deps);
    expect(result).toEqual({ kind: "none" });
  });

  it("resolves directly when the caller has exactly one team", async () => {
    const deps = makeDeps();
    deps.membershipRepo.rows.push({
      id: asMembershipId("m-1"),
      teamId: teamA,
      memberId: asMemberId("u-1"),
      role: "member",
      joinedAt: 0,
    });

    const result = await resolveDmTeam({ telegramUserId }, deps);
    expect(result).toEqual({ kind: "resolved", teamId: teamA });
  });

  it("requires a picker selection with two or more teams and no prior selection", async () => {
    const deps = makeDeps();
    deps.membershipRepo.rows.push(
      { id: asMembershipId("m-1"), teamId: teamA, memberId: asMemberId("u-1"), role: "member", joinedAt: 0 },
      { id: asMembershipId("m-2"), teamId: teamB, memberId: asMemberId("u-1"), role: "member", joinedAt: 0 },
    );

    const result = await resolveDmTeam({ telegramUserId }, deps);
    expect(result).toEqual({ kind: "needs-selection" });
  });

  it("re-verifies and honors a selection made less than 15 minutes ago", async () => {
    const deps = makeDeps();
    deps.membershipRepo.rows.push(
      { id: asMembershipId("m-1"), teamId: teamA, memberId: asMemberId("u-1"), role: "member", joinedAt: 0 },
      { id: asMembershipId("m-2"), teamId: teamB, memberId: asMemberId("u-1"), role: "member", joinedAt: 0 },
    );
    await selectDmTeam({ telegramUserId, teamId: teamA }, deps);

    const result = await resolveDmTeam({ telegramUserId }, deps);
    expect(result).toEqual({ kind: "resolved", teamId: teamA });
  });

  it("discards a selection older than 15 minutes and requires the picker again", async () => {
    const deps = makeDeps();
    deps.membershipRepo.rows.push(
      { id: asMembershipId("m-1"), teamId: teamA, memberId: asMemberId("u-1"), role: "member", joinedAt: 0 },
      { id: asMembershipId("m-2"), teamId: teamB, memberId: asMemberId("u-1"), role: "member", joinedAt: 0 },
    );
    await selectDmTeam({ telegramUserId, teamId: teamA }, deps);
    deps.clock.advance(15 * 60 * 1000 + 1);

    const result = await resolveDmTeam({ telegramUserId }, deps);
    expect(result).toEqual({ kind: "needs-selection" });
  });

  it("discards a selection when membership in the selected team is lost, still requiring a picker among remaining teams", async () => {
    const deps = makeDeps();
    deps.membershipRepo.rows.push(
      { id: asMembershipId("m-1"), teamId: teamA, memberId: asMemberId("u-1"), role: "member", joinedAt: 0 },
      { id: asMembershipId("m-2"), teamId: teamB, memberId: asMemberId("u-1"), role: "member", joinedAt: 0 },
      { id: asMembershipId("m-3"), teamId: teamC, memberId: asMemberId("u-1"), role: "member", joinedAt: 0 },
    );
    await selectDmTeam({ telegramUserId, teamId: teamA }, deps);
    deps.membershipRepo.rows.splice(
      deps.membershipRepo.rows.findIndex((m) => m.teamId === teamA),
      1,
    );

    const result = await resolveDmTeam({ telegramUserId }, deps);
    expect(result).toEqual({ kind: "needs-selection" });
  });
});

describe("selectDmTeam", () => {
  it("refuses selecting a team the caller is not a member of (forged/stale selection)", async () => {
    const deps = makeDeps();
    deps.membershipRepo.rows.push({
      id: asMembershipId("m-1"),
      teamId: teamA,
      memberId: asMemberId("u-1"),
      role: "member",
      joinedAt: 0,
    });

    await expect(
      selectDmTeam({ telegramUserId, teamId: teamB }, deps),
    ).rejects.toThrow(UnauthorizedError);
    expect(deps.dmSelectionRepo.rows).toHaveLength(0);
  });
});
