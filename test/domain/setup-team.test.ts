import { describe, expect, it } from "vitest";
import { setupTeam } from "../../src/domain/usecases/setup-team";
import { AlreadyExistsError, ChatAdminCheckFailedError, UnauthorizedError } from "../../src/domain/errors";
import {
  fakeChatAdminChecker,
  fakeClock,
  fakeIdGen,
  fakeMemberRepo,
  fakeMembershipRepo,
  fakeTeamRepo,
} from "../fakes";

function makeDeps(opts: { admin: boolean; throws?: boolean }) {
  const memberRepo = fakeMemberRepo();
  return {
    teamRepo: fakeTeamRepo(),
    memberRepo,
    membershipRepo: fakeMembershipRepo(memberRepo),
    chatAdminChecker: fakeChatAdminChecker(
      opts.admin ? [{ chatId: 100, userId: 1 }] : [],
      { throws: opts.throws },
    ),
    clock: fakeClock(),
    idGen: fakeIdGen(),
  };
}

describe("setupTeam", () => {
  it("creates a team and an admin membership for the caller", async () => {
    const deps = makeDeps({ admin: true });
    const team = await setupTeam({ chatId: 100, callerTelegramUserId: 1 }, deps);

    expect(team.chatId).toBe(100);
    expect(deps.membershipRepo.rows).toHaveLength(1);
    expect(deps.membershipRepo.rows[0]?.role).toBe("admin");
  });

  it("refuses when a team already exists for the chat", async () => {
    const deps = makeDeps({ admin: true });
    await setupTeam({ chatId: 100, callerTelegramUserId: 1 }, deps);

    await expect(
      setupTeam({ chatId: 100, callerTelegramUserId: 2 }, deps),
    ).rejects.toThrow(AlreadyExistsError);
    expect(deps.membershipRepo.rows).toHaveLength(1);
  });

  it("refuses and creates nothing when getChatMember fails", async () => {
    const deps = makeDeps({ admin: true, throws: true });

    await expect(
      setupTeam({ chatId: 100, callerTelegramUserId: 1 }, deps),
    ).rejects.toThrow(ChatAdminCheckFailedError);
    expect(deps.teamRepo.rows).toHaveLength(0);
    expect(deps.membershipRepo.rows).toHaveLength(0);
  });

  it("refuses when the caller is not a group admin", async () => {
    const deps = makeDeps({ admin: false });

    await expect(
      setupTeam({ chatId: 100, callerTelegramUserId: 1 }, deps),
    ).rejects.toThrow(UnauthorizedError);
    expect(deps.teamRepo.rows).toHaveLength(0);
    expect(deps.membershipRepo.rows).toHaveLength(0);
  });
});
