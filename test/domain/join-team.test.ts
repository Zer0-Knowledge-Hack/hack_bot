import { describe, expect, it } from "vitest";
import { joinTeam } from "../../src/domain/usecases/join-team";
import { AlreadyExistsError, NotFoundError } from "../../src/domain/errors";
import { asMemberId, asTeamId } from "../../src/domain/ids";
import type { Member } from "../../src/domain/entities";
import type { MemberRepo } from "../../src/domain/ports";
import {
  fakeClock,
  fakeIdGen,
  fakeMemberRepo,
  fakeMembershipRepo,
  fakeTeamRepo,
} from "../fakes";

function makeDeps() {
  const memberRepo = fakeMemberRepo();
  const teamRepo = fakeTeamRepo();
  return {
    teamRepo,
    memberRepo,
    membershipRepo: fakeMembershipRepo(memberRepo),
    clock: fakeClock(),
    idGen: fakeIdGen(),
  };
}

describe("joinTeam", () => {
  it("creates a member-role membership for a new user", async () => {
    const deps = makeDeps();
    deps.teamRepo.rows.push({
      id: asTeamId("team-1"),
      chatId: 100,
      dataTopicThreadId: null,
      createdAt: 0,
    });

    const result = await joinTeam({ chatId: 100, callerTelegramUserId: 5 }, deps);

    expect(result.role).toBe("member");
    expect(deps.membershipRepo.rows).toHaveLength(1);
  });

  it("refuses when the caller already has a membership in this team", async () => {
    const deps = makeDeps();
    deps.teamRepo.rows.push({
      id: asTeamId("team-1"),
      chatId: 100,
      dataTopicThreadId: null,
      createdAt: 0,
    });
    await joinTeam({ chatId: 100, callerTelegramUserId: 5 }, deps);

    await expect(
      joinTeam({ chatId: 100, callerTelegramUserId: 5 }, deps),
    ).rejects.toThrow(AlreadyExistsError);
    expect(deps.membershipRepo.rows).toHaveLength(1);
  });

  it("refuses when no team is registered for the chat", async () => {
    const deps = makeDeps();

    await expect(
      joinTeam({ chatId: 999, callerTelegramUserId: 5 }, deps),
    ).rejects.toThrow(NotFoundError);
  });

  it("RES-002: uses the persisted member id returned by upsert when a concurrent writer raced ahead of the pre-read", async () => {
    const deps = makeDeps();
    deps.teamRepo.rows.push({
      id: asTeamId("team-1"),
      chatId: 100,
      dataTopicThreadId: null,
      createdAt: 0,
    });

    // Simulates: our pre-read (findByTelegramUserId) observed no row (a
    // real race), but by the time upsert() runs, a concurrent writer has
    // already persisted the member under a DIFFERENT id. A correct
    // MemberRepo.upsert MUST return that already-persisted member instead
    // of silently returning void and letting the caller keep using a
    // locally generated id nothing was ever inserted under.
    const persisted: Member = {
      id: asMemberId("member-from-concurrent-writer"),
      telegramUserId: 5,
      createdAt: 0,
    };
    const racyMemberRepo: MemberRepo = {
      findByTelegramUserId: async () => null,
      upsert: async () => persisted,
    };
    deps.memberRepo = racyMemberRepo as typeof deps.memberRepo;

    const result = await joinTeam({ chatId: 100, callerTelegramUserId: 5 }, deps);

    expect(deps.membershipRepo.rows).toHaveLength(1);
    expect(deps.membershipRepo.rows[0]?.memberId).toBe("member-from-concurrent-writer");
    expect(result.memberId).toBe("member-from-concurrent-writer");
  });
});
