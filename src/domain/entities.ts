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
  value: string;
  keyVersion: number | null;
  updatedAt: number;
}

export interface AuditDraft {
  field: string;
  oldValue: string | null;
  newValue: string | null;
  keyVersion: number | null;
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
