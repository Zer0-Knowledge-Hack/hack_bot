import { describe, expect, it } from "vitest";
import { readProfiles } from "../../src/domain/usecases/read-profiles";
import { NotFoundError, UnauthorizedError } from "../../src/domain/errors";
import { asMemberId, asMembershipId, asTeamId } from "../../src/domain/ids";
import {
  fakeMemberRepo,
  fakeMembershipRepo,
  fakeProfileRepo,
  fakeTeamRepo,
} from "../fakes";

const teamId = asTeamId("team-1");
const otherTeamId = asTeamId("team-2");
const chatId = 100;
const dataThreadId = 5;
const telegramUserId = 7;

function makeDeps() {
  const memberRepo = fakeMemberRepo();
  const membershipRepo = fakeMembershipRepo(memberRepo);
  const teamRepo = fakeTeamRepo();
  const profileRepo = fakeProfileRepo();
  return { memberRepo, membershipRepo, teamRepo, profileRepo };
}

function seedMember(deps: ReturnType<typeof makeDeps>) {
  const memberId = asMemberId("u-1");
  deps.memberRepo.rows.push({ id: memberId, telegramUserId, createdAt: 0 });
  const membershipId = asMembershipId("m-1");
  deps.membershipRepo.rows.push({
    id: membershipId,
    teamId,
    memberId,
    role: "member",
    joinedAt: 0,
  });
  return { memberId, membershipId };
}

describe("readProfiles", () => {
  it("replies with team-scoped data when the command runs inside the bound data channel", async () => {
    const deps = makeDeps();
    deps.teamRepo.rows.push({
      id: teamId,
      chatId,
      dataTopicThreadId: dataThreadId,
      createdAt: 0,
    });
    const { membershipId } = seedMember(deps);
    deps.profileRepo.rows.push({
      teamId,
      membershipId,
      field: "full_name",
      value: "cipher:alice",
      keyVersion: 1,
      updatedAt: 0,
    });

    const result = await readProfiles(
      { context: { kind: "group", chatId, threadId: dataThreadId }, callerTelegramUserId: telegramUserId },
      deps,
    );

    expect(result).toEqual([
      {
        teamId,
        membershipId,
        field: "full_name",
        value: "cipher:alice",
        keyVersion: 1,
        updatedAt: 0,
      },
    ]);
  });

  it("refuses a group command run outside the bound data channel", async () => {
    const deps = makeDeps();
    deps.teamRepo.rows.push({
      id: teamId,
      chatId,
      dataTopicThreadId: dataThreadId,
      createdAt: 0,
    });
    seedMember(deps);

    await expect(
      readProfiles(
        { context: { kind: "group", chatId, threadId: 999 }, callerTelegramUserId: telegramUserId },
        deps,
      ),
    ).rejects.toThrow(UnauthorizedError);
  });

  it("refuses a group command when the team has no data channel bound yet", async () => {
    const deps = makeDeps();
    deps.teamRepo.rows.push({
      id: teamId,
      chatId,
      dataTopicThreadId: null,
      createdAt: 0,
    });
    seedMember(deps);

    await expect(
      readProfiles(
        { context: { kind: "group", chatId, threadId: dataThreadId }, callerTelegramUserId: telegramUserId },
        deps,
      ),
    ).rejects.toThrow(UnauthorizedError);
  });

  it("replies with team-scoped data for a registered member via DM", async () => {
    const deps = makeDeps();
    const { membershipId } = seedMember(deps);
    deps.profileRepo.rows.push({
      teamId,
      membershipId,
      field: "github_username",
      value: "alice-gh",
      keyVersion: null,
      updatedAt: 0,
    });

    const result = await readProfiles(
      { context: { kind: "dm", teamId }, callerTelegramUserId: telegramUserId },
      deps,
    );

    expect(result).toEqual([
      {
        teamId,
        membershipId,
        field: "github_username",
        value: "alice-gh",
        keyVersion: null,
        updatedAt: 0,
      },
    ]);
  });

  it("refuses a caller who is not a member of the resolved team (cross-team)", async () => {
    const deps = makeDeps();
    seedMember(deps);

    await expect(
      readProfiles(
        { context: { kind: "dm", teamId: otherTeamId }, callerTelegramUserId: telegramUserId },
        deps,
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it("never returns another team's profile data even when both teams exist", async () => {
    const deps = makeDeps();
    const { membershipId } = seedMember(deps);
    deps.profileRepo.rows.push(
      { teamId, membershipId, field: "full_name", value: "cipher:a", keyVersion: 1, updatedAt: 0 },
      {
        teamId: otherTeamId,
        membershipId: asMembershipId("m-other"),
        field: "full_name",
        value: "cipher:b",
        keyVersion: 1,
        updatedAt: 0,
      },
    );

    const result = await readProfiles(
      { context: { kind: "dm", teamId }, callerTelegramUserId: telegramUserId },
      deps,
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.teamId).toBe(teamId);
  });

  it("passes an unreadable field marker through unchanged (RES-001)", async () => {
    const deps = makeDeps();
    const { membershipId } = seedMember(deps);
    deps.profileRepo.rows.push({
      teamId,
      membershipId,
      field: "full_name",
      value: "",
      keyVersion: 99,
      updatedAt: 0,
      unreadable: true,
    });

    const result = await readProfiles(
      { context: { kind: "dm", teamId }, callerTelegramUserId: telegramUserId },
      deps,
    );

    expect(result).toEqual([
      {
        teamId,
        membershipId,
        field: "full_name",
        value: "",
        keyVersion: 99,
        updatedAt: 0,
        unreadable: true,
      },
    ]);
  });
});
