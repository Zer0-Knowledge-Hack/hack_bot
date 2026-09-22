import type { Team } from "../entities";
import { AlreadyExistsError, ChatAdminCheckFailedError, UnauthorizedError } from "../errors";
import { asMemberId, asMembershipId, asTeamId } from "../ids";
import type {
  ChatAdminChecker,
  Clock,
  IdGen,
  MemberRepo,
  MembershipRepo,
  TeamRepo,
} from "../ports";

export interface SetupTeamInput {
  chatId: number;
  callerTelegramUserId: number;
}

export interface SetupTeamDeps {
  teamRepo: TeamRepo;
  memberRepo: MemberRepo;
  membershipRepo: MembershipRepo;
  chatAdminChecker: ChatAdminChecker;
  clock: Clock;
  idGen: IdGen;
}

export async function setupTeam(
  input: SetupTeamInput,
  deps: SetupTeamDeps,
): Promise<Team> {
  const existing = await deps.teamRepo.findByChatId(input.chatId);
  if (existing) {
    throw new AlreadyExistsError("Team already exists for this chat");
  }

  let isAdmin: boolean;
  try {
    isAdmin = await deps.chatAdminChecker.isAdmin(
      input.chatId,
      input.callerTelegramUserId,
    );
  } catch {
    throw new ChatAdminCheckFailedError(
      "Could not verify the caller's admin status",
    );
  }
  if (!isAdmin) {
    throw new UnauthorizedError("Caller is not a group admin");
  }

  const now = deps.clock.now();
  const team: Team = {
    id: asTeamId(deps.idGen.newId()),
    chatId: input.chatId,
    dataTopicThreadId: null,
    createdAt: now,
  };
  await deps.teamRepo.create(team);

  let member = await deps.memberRepo.findByTelegramUserId(
    input.callerTelegramUserId,
  );
  if (!member) {
    // RES-002: upsert returns the ACTUALLY persisted member — a concurrent
    // writer may have raced ahead of the pre-read above and already
    // created this member under a different id. Use the returned member,
    // never the locally generated one, for the membership FK below.
    member = await deps.memberRepo.upsert({
      id: asMemberId(deps.idGen.newId()),
      telegramUserId: input.callerTelegramUserId,
      createdAt: now,
    });
  }

  await deps.membershipRepo.create(
    {
      id: asMembershipId(deps.idGen.newId()),
      teamId: team.id,
      memberId: member.id,
      role: "admin",
      joinedAt: now,
    },
    { field: "role", oldValue: null, newValue: "admin", keyVersion: null },
  );

  return team;
}
