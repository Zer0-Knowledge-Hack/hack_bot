import type { Membership } from "../entities";
import { AlreadyExistsError, NotFoundError } from "../errors";
import { asMemberId, asMembershipId } from "../ids";
import type { Clock, IdGen, MemberRepo, MembershipRepo, TeamRepo } from "../ports";

export interface JoinTeamInput {
  chatId: number;
  callerTelegramUserId: number;
}

export interface JoinTeamDeps {
  teamRepo: TeamRepo;
  memberRepo: MemberRepo;
  membershipRepo: MembershipRepo;
  clock: Clock;
  idGen: IdGen;
}

export async function joinTeam(
  input: JoinTeamInput,
  deps: JoinTeamDeps,
): Promise<Membership> {
  const team = await deps.teamRepo.findByChatId(input.chatId);
  if (!team) {
    throw new NotFoundError("No team registered for this chat");
  }

  const now = deps.clock.now();
  let member = await deps.memberRepo.findByTelegramUserId(
    input.callerTelegramUserId,
  );
  if (!member) {
    member = {
      id: asMemberId(deps.idGen.newId()),
      telegramUserId: input.callerTelegramUserId,
      createdAt: now,
    };
    await deps.memberRepo.upsert(member);
  }

  const existingMembership = await deps.membershipRepo.getByMember(
    team.id,
    member.id,
  );
  if (existingMembership) {
    throw new AlreadyExistsError("Already a member of this team");
  }

  const membership: Membership = {
    id: asMembershipId(deps.idGen.newId()),
    teamId: team.id,
    memberId: member.id,
    role: "member",
    joinedAt: now,
  };
  await deps.membershipRepo.create(membership, {
    field: "role",
    oldValue: null,
    newValue: "member",
    keyVersion: null,
  });

  return membership;
}
