// Branded identifier types. Branding prevents accidentally passing a raw
// string (e.g. a MemberId) where a TeamId is required — the compiler enforces
// tenant-scoping at every port method signature.

export type TeamId = string & { readonly __brand: "TeamId" };
export type MemberId = string & { readonly __brand: "MemberId" };
export type MembershipId = string & { readonly __brand: "MembershipId" };

// Trusted construction only (ids we generated or read back from D1).
export function asTeamId(id: string): TeamId {
  return id as TeamId;
}

// Same character set and length the ids we generate (crypto.randomUUID)
// fit in. Used for untrusted input (e.g. callback data) so a TeamId is
// never built from an unchecked string. The unanchored source is exported
// so adapters that embed a team id in a larger format (e.g. callback data)
// reuse this single rule instead of restating it.
export const TEAM_ID_PATTERN_SOURCE = "[a-z0-9-]{1,64}";
const TEAM_ID_PATTERN = new RegExp(`^${TEAM_ID_PATTERN_SOURCE}$`, "i");

export function parseTeamId(raw: string): TeamId | null {
  return TEAM_ID_PATTERN.test(raw) ? (raw as TeamId) : null;
}

export function asMemberId(id: string): MemberId {
  return id as MemberId;
}

export function asMembershipId(id: string): MembershipId {
  return id as MembershipId;
}
