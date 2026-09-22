// Branded identifier types. Branding prevents accidentally passing a raw
// string (e.g. a MemberId) where a TeamId is required — the compiler enforces
// tenant-scoping at every port method signature.

export type TeamId = string & { readonly __brand: "TeamId" };
export type MemberId = string & { readonly __brand: "MemberId" };
export type MembershipId = string & { readonly __brand: "MembershipId" };

export function asTeamId(id: string): TeamId {
  return id as TeamId;
}

export function asMemberId(id: string): MemberId {
  return id as MemberId;
}

export function asMembershipId(id: string): MembershipId {
  return id as MembershipId;
}
