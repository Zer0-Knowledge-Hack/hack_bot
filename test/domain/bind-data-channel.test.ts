import { describe, expect, it } from "vitest";
import { bindDataChannel } from "../../src/domain/usecases/bind-data-channel";
import { UnauthorizedError } from "../../src/domain/errors";
import { asMemberId, asMembershipId, asTeamId } from "../../src/domain/ids";
import { fakeMemberRepo, fakeMembershipRepo, fakeTeamRepo } from "../fakes";

const teamId = asTeamId("team-1");

function makeDeps() {
  const memberRepo = fakeMemberRepo();
  return {
    teamRepo: fakeTeamRepo(),
    membershipRepo: fakeMembershipRepo(memberRepo),
  };
}

describe("bindDataChannel", () => {
  it("lets a team admin bind the data channel thread", async () => {
    const deps = makeDeps();
    deps.teamRepo.rows.push({ id: teamId, chatId: 1, dataTopicThreadId: null, createdAt: 0 });
    const adminId = asMembershipId("m-admin");
    deps.membershipRepo.rows.push({
      id: adminId,
      teamId,
      memberId: asMemberId("u-admin"),
      role: "admin",
      joinedAt: 0,
    });

    await bindDataChannel({ teamId, actorMembershipId: adminId, threadId: 42 }, deps);

    expect(deps.teamRepo.rows[0]?.dataTopicThreadId).toBe(42);
  });

  it("writes one audit row recording the previous and new data channel thread", async () => {
    const deps = makeDeps();
    deps.teamRepo.rows.push({ id: teamId, chatId: 1, dataTopicThreadId: null, createdAt: 0 });
    const adminId = asMembershipId("m-admin");
    deps.membershipRepo.rows.push({
      id: adminId,
      teamId,
      memberId: asMemberId("u-admin"),
      role: "admin",
      joinedAt: 0,
    });

    await bindDataChannel({ teamId, actorMembershipId: adminId, threadId: 42 }, deps);

    expect(deps.teamRepo.audits).toHaveLength(1);
    expect(deps.teamRepo.audits[0]).toEqual({
      field: "data_topic_thread_id",
      oldValue: null,
      newValue: "42",
      keyVersion: null,
    });
  });

  it("re-binding records the previous thread id as oldValue", async () => {
    const deps = makeDeps();
    deps.teamRepo.rows.push({ id: teamId, chatId: 1, dataTopicThreadId: 7, createdAt: 0 });
    const adminId = asMembershipId("m-admin");
    deps.membershipRepo.rows.push({
      id: adminId,
      teamId,
      memberId: asMemberId("u-admin"),
      role: "admin",
      joinedAt: 0,
    });

    await bindDataChannel({ teamId, actorMembershipId: adminId, threadId: 99 }, deps);

    expect(deps.teamRepo.audits[0]).toEqual({
      field: "data_topic_thread_id",
      oldValue: "7",
      newValue: "99",
      keyVersion: null,
    });
  });

  it("refuses a non-admin and does not change the stored data channel", async () => {
    const deps = makeDeps();
    deps.teamRepo.rows.push({ id: teamId, chatId: 1, dataTopicThreadId: null, createdAt: 0 });
    const memberId = asMembershipId("m-member");
    deps.membershipRepo.rows.push({
      id: memberId,
      teamId,
      memberId: asMemberId("u-member"),
      role: "member",
      joinedAt: 0,
    });

    await expect(
      bindDataChannel({ teamId, actorMembershipId: memberId, threadId: 42 }, deps),
    ).rejects.toThrow(UnauthorizedError);
    expect(deps.teamRepo.rows[0]?.dataTopicThreadId).toBeNull();
  });
});
