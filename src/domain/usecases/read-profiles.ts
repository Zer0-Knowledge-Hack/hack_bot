import type { ProfileField } from "../entities";
import { NotFoundError, UnauthorizedError } from "../errors";
import type { MembershipId, TeamId } from "../ids";
import type { MemberRepo, MembershipRepo, ProfileRepo, TeamRepo } from "../ports";

// The caller-facing context that determines how the team scope is resolved
// and gated. Group commands resolve the team from the chat and MUST be
// gated to the team's bound data channel (design.md "Data channel"). DM
// commands trust an already-resolved team scope (see resolve-dm-team.ts) —
// membership is still re-verified below.
export type ReadProfilesContext =
  | { kind: "group"; chatId: number; threadId: number | null }
  | { kind: "dm"; teamId: TeamId };

export interface ReadProfilesInput {
  context: ReadProfilesContext;
  callerTelegramUserId: number;
  targetMembershipId?: MembershipId;
}

export interface ReadProfilesDeps {
  teamRepo: TeamRepo;
  memberRepo: MemberRepo;
  membershipRepo: MembershipRepo;
  profileRepo: ProfileRepo;
}

async function resolveTeamScope(
  context: ReadProfilesContext,
  deps: ReadProfilesDeps,
): Promise<TeamId> {
  if (context.kind === "dm") {
    return context.teamId;
  }

  const team = await deps.teamRepo.findByChatId(context.chatId);
  if (!team) {
    throw new NotFoundError("No team is registered for this chat");
  }
  if (team.dataTopicThreadId === null || team.dataTopicThreadId !== context.threadId) {
    throw new UnauthorizedError(
      "Member-data commands must be run inside the team's data channel",
    );
  }
  return team.id;
}

export async function readProfiles(
  input: ReadProfilesInput,
  deps: ReadProfilesDeps,
): Promise<ProfileField[]> {
  const teamId = await resolveTeamScope(input.context, deps);

  const member = await deps.memberRepo.findByTelegramUserId(input.callerTelegramUserId);
  if (!member) {
    throw new NotFoundError("Caller is not a registered member");
  }
  const actor = await deps.membershipRepo.getByMember(teamId, member.id);
  if (!actor) {
    throw new NotFoundError("Caller is not a member of this team");
  }

  return deps.profileRepo.list(teamId, input.targetMembershipId);
}
