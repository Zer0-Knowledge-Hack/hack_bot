import { describe, expect, it } from "vitest";
import { setupTeam } from "../../src/domain/usecases/setup-team";
import { AlreadyExistsError, ChatAdminCheckFailedError, UnauthorizedError } from "../../src/domain/errors";
import { asMemberId } from "../../src/domain/ids";
import type { Member } from "../../src/domain/entities";
import type { MemberRepo } from "../../src/domain/ports";
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

  it("RES-002: uses the persisted member id returned by upsert when a concurrent writer raced ahead of the pre-read", async () => {
    const deps = makeDeps({ admin: true });

    // Simulates: our pre-read (findByTelegramUserId) observed no row (a
    // real race), but by the time upsert() runs, a concurrent writer has
    // already persisted the member under a DIFFERENT id. A correct
    // MemberRepo.upsert MUST return that already-persisted member instead
    // of silently returning void and letting the caller keep using a
    // locally generated id nothing was ever inserted under.
    const persisted: Member = {
      id: asMemberId("member-from-concurrent-writer"),
      telegramUserId: 1,
      createdAt: 0,
    };
    const racyMemberRepo: MemberRepo = {
      findByTelegramUserId: async () => null,
      upsert: async () => persisted,
    };
    deps.memberRepo = racyMemberRepo as typeof deps.memberRepo;

    await setupTeam({ chatId: 100, callerTelegramUserId: 1 }, deps);

    expect(deps.membershipRepo.rows).toHaveLength(1);
    expect(deps.membershipRepo.rows[0]?.memberId).toBe("member-from-concurrent-writer");
  });
});
