import type { MemberId, MembershipId, TeamId } from "./ids";

export interface Team {
  id: TeamId;
  chatId: number;
  dataTopicThreadId: number | null;
  createdAt: number;
}

export interface Member {
  id: MemberId;
  telegramUserId: number;
  createdAt: number;
}

export type Role = "member" | "admin";

export interface Membership {
  id: MembershipId;
  teamId: TeamId;
  memberId: MemberId;
  role: Role;
  joinedAt: number;
}

export type ProfileFieldName =
  | "full_name"
  | "emails"
  | "social_links"
  | "github_username";

export interface ProfileField {
  teamId: TeamId;
  membershipId: MembershipId;
  field: ProfileFieldName;
  // Empty string when `unreadable` is set — see `unreadable` below. Never
  // holds ciphertext or partial plaintext.
  value: string;
  keyVersion: number | null;
  updatedAt: number;
  // Set when this field's stored ciphertext could not be decrypted (wrong
  // AAD, unknown key version, or corrupted value — see FieldUnreadableError,
  // design.md "PII Never Logged"). `value` is `""` in that case: the field
  // is explicitly marked broken, never silently dropped from a listing and
  // never leaking ciphertext to the caller. Omitted (not `false`) when the
  // field decrypted successfully or needs no decryption.
  unreadable?: true;
}

export interface AuditDraft {
  field: string;
  oldValue: string | null;
  newValue: string | null;
  keyVersion: number | null;
  // Set when the prior field value could not be decrypted (see
  // ProfileField.unreadable / FIX-001) — `oldValue` is `null` in that case,
  // NEVER a fabricated placeholder. Adapters that persist an audit trail
  // MUST preserve the original stored ciphertext (not derive it from
  // `oldValue`) when this is set, so it stays recoverable if the key
  // reappears. Omitted (not `false`) when `oldValue` reflects a real prior
  // plaintext or there was no prior value.
  oldValueUnreadable?: true;
}

export interface AuditEntry extends AuditDraft {
  id: string;
  teamId: TeamId;
  actorMembershipId: MembershipId;
  targetMembershipId: MembershipId;
  createdAt: number;
}

export interface DmSelection {
  telegramUserId: number;
  teamId: TeamId;
  expiresAt: number;
}
