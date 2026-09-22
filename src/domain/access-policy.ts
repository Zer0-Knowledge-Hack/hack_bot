import type { Membership, Role } from "./entities";

// Pure policy functions. No I/O, no ports — the use cases fetch the
// memberships and pass them here for a decision.

export function canEditProfile(actor: Membership, target: Membership): boolean {
  if (actor.teamId !== target.teamId) return false;
  return actor.id === target.id || actor.role === "admin";
}

export function canChangeRole(actor: Membership, target: Membership): boolean {
  if (actor.teamId !== target.teamId) return false;
  return actor.role === "admin";
}

export function isLastAdminDemotion(
  target: Membership,
  newRole: Role,
  adminCount: number,
): boolean {
  return target.role === "admin" && newRole === "member" && adminCount <= 1;
}
