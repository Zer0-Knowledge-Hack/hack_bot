import { UnauthorizedError } from "../errors";
import type { TeamId } from "../ids";
import type { Clock, DmSelectionRepo, MembershipRepo } from "../ports";

export const DM_SELECTION_TTL_MS = 15 * 60 * 1000;

export type DmResolution =
  | { kind: "none" }
  | { kind: "needs-selection" }
  | { kind: "resolved"; teamId: TeamId };

export interface ResolveDmTeamInput {
  telegramUserId: number;
}

export interface DmTeamDeps {
  membershipRepo: MembershipRepo;
  dmSelectionRepo: DmSelectionRepo;
  clock: Clock;
}

export async function resolveDmTeam(
  input: ResolveDmTeamInput,
  deps: DmTeamDeps,
): Promise<DmResolution> {
  const memberships = await deps.membershipRepo.findByUser(input.telegramUserId);
  if (memberships.length === 0) {
    return { kind: "none" };
  }
  if (memberships.length === 1 && memberships[0]) {
    return { kind: "resolved", teamId: memberships[0].teamId };
  }

  const selection = await deps.dmSelectionRepo.get(input.telegramUserId);
  if (selection && selection.expiresAt > deps.clock.now()) {
    const stillMember = memberships.some((m) => m.teamId === selection.teamId);
    if (stillMember) {
      return { kind: "resolved", teamId: selection.teamId };
    }
  }

  return { kind: "needs-selection" };
}

export interface SelectDmTeamInput {
  telegramUserId: number;
  teamId: TeamId;
}

export async function selectDmTeam(
  input: SelectDmTeamInput,
  deps: DmTeamDeps,
): Promise<void> {
  const memberships = await deps.membershipRepo.findByUser(input.telegramUserId);
  const isMember = memberships.some((m) => m.teamId === input.teamId);
  if (!isMember) {
    throw new UnauthorizedError("Not a member of the selected team");
  }

  await deps.dmSelectionRepo.set({
    telegramUserId: input.telegramUserId,
    teamId: input.teamId,
    expiresAt: deps.clock.now() + DM_SELECTION_TTL_MS,
  });
}
