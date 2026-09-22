import { describe, expect, it } from "vitest";
import { joinTeam } from "../../src/domain/usecases/join-team";
import { AlreadyExistsError, NotFoundError } from "../../src/domain/errors";
import { asTeamId } from "../../src/domain/ids";
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
});
