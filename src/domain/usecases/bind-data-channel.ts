import { NotFoundError, UnauthorizedError } from "../errors";
import type { MembershipId, TeamId } from "../ids";
import type { MembershipRepo, TeamRepo } from "../ports";

export interface BindDataChannelInput {
  teamId: TeamId;
  actorMembershipId: MembershipId;
  threadId: number;
}

export interface BindDataChannelDeps {
  teamRepo: TeamRepo;
  membershipRepo: MembershipRepo;
}

export async function bindDataChannel(
  input: BindDataChannelInput,
  deps: BindDataChannelDeps,
): Promise<void> {
  const actor = await deps.membershipRepo.get(input.teamId, input.actorMembershipId);
  if (!actor) {
    throw new NotFoundError("Actor membership not found");
  }
  if (actor.role !== "admin") {
    throw new UnauthorizedError("Only a team admin may bind the data channel");
  }

  const team = await deps.teamRepo.get(input.teamId);
  if (!team) {
    throw new NotFoundError("Team not found");
  }

  await deps.teamRepo.bindDataChannel(input.teamId, input.threadId, actor.id, {
    field: "data_topic_thread_id",
    oldValue: team.dataTopicThreadId === null ? null : String(team.dataTopicThreadId),
    newValue: String(input.threadId),
    keyVersion: null,
  });
}
