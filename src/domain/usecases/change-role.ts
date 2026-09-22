import { canChangeRole, isLastAdminDemotion } from "../access-policy";
import type { Role } from "../entities";
import { LastAdminError, NotFoundError, UnauthorizedError } from "../errors";
import type { MembershipId, TeamId } from "../ids";
import type { MembershipRepo } from "../ports";

export interface ChangeRoleInput {
  teamId: TeamId;
  actorMembershipId: MembershipId;
  targetMembershipId: MembershipId;
  newRole: Role;
}

export interface ChangeRoleDeps {
  membershipRepo: MembershipRepo;
}

export async function changeRole(
  input: ChangeRoleInput,
  deps: ChangeRoleDeps,
): Promise<void> {
  const actor = await deps.membershipRepo.get(input.teamId, input.actorMembershipId);
  const target = await deps.membershipRepo.get(input.teamId, input.targetMembershipId);
  if (!actor || !target) {
    throw new NotFoundError("Actor or target membership not found");
  }
  if (!canChangeRole(actor, target)) {
    throw new UnauthorizedError("Caller is not an admin of this team");
  }

  const isDemotion = target.role === "admin" && input.newRole === "member";

  if (isDemotion) {
    // Friendly early error only — a fast, non-authoritative check so a
    // solo caller gets an immediate, clear refusal. It can observe a
    // stale admin count under concurrency; it MUST NOT be relied on for
    // correctness. The atomic port-level precondition below is what
    // actually enforces the invariant.
    const memberships = await deps.membershipRepo.listByTeam(input.teamId);
    const adminCount = memberships.filter((m) => m.role === "admin").length;
    if (isLastAdminDemotion(target, input.newRole, adminCount)) {
      throw new LastAdminError("Cannot demote the last remaining admin");
    }
  }

  const result = await deps.membershipRepo.changeRole(
    input.teamId,
    target.id,
    input.newRole,
    {
      field: "role",
      oldValue: target.role,
      newValue: input.newRole,
      keyVersion: null,
    },
    isDemotion ? { requireRemainingAdmin: true } : undefined,
  );

  if (!result.applied) {
    throw new LastAdminError("Cannot demote the last remaining admin");
  }
}
