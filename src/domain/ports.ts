import type {
  AuditDraft,
  Member,
  Membership,
  ProfileField,
  DmSelection,
  Team,
} from "./entities";
import type { MemberId, MembershipId, TeamId } from "./ids";
import type { Role } from "./entities";

// Every tenant-scoped method takes TeamId as its first parameter. This is a
// deliberate design constraint (see design.md "Tenancy") that makes
// cross-tenant leaks a type-checkable mistake, not just a review nit.

export interface TeamRepo {
  findByChatId(chatId: number): Promise<Team | null>;
  get(teamId: TeamId): Promise<Team | null>;
  create(team: Team): Promise<void>;
  // Persists the bound thread id and its audit row atomically (design.md
  // "Atomicity" — same one-batch-write contract as MembershipRepo/ProfileRepo
  // write methods).
  bindDataChannel(
    teamId: TeamId,
    threadId: number,
    audit: AuditDraft,
  ): Promise<void>;
}

export interface MemberRepo {
  findByTelegramUserId(telegramUserId: number): Promise<Member | null>;
  upsert(member: Member): Promise<void>;
}

export interface MembershipRepo {
  // Cross-team lookup is intentional here — this is the ONLY port method
  // allowed to see a caller's memberships across teams, used solely for DM
  // team resolution.
  findByUser(telegramUserId: number): Promise<Membership[]>;
  get(teamId: TeamId, membershipId: MembershipId): Promise<Membership | null>;
  getByMember(
    teamId: TeamId,
    memberId: MemberId,
  ): Promise<Membership | null>;
  listByTeam(teamId: TeamId): Promise<Membership[]>;
  create(membership: Membership, audit: AuditDraft): Promise<void>;
  // Atomicity contract: when `options.requireRemainingAdmin` is set, the
  // role update and the "at least one admin remains" check MUST be applied
  // as a single indivisible operation (e.g. one conditional SQL statement:
  // `UPDATE memberships SET role=? WHERE team_id=? AND id=? AND
  // (SELECT COUNT(*) FROM memberships WHERE team_id=? AND role='admin') > 1`).
  // Correctness must NOT depend on a caller-side pre-read of the admin
  // count (that read can be stale under concurrent demotions) — the
  // precondition MUST be re-evaluated at write time and the result MUST
  // reflect whether the write actually applied.
  changeRole(
    teamId: TeamId,
    membershipId: MembershipId,
    role: Role,
    audit: AuditDraft,
    options?: { requireRemainingAdmin: boolean },
  ): Promise<ChangeRoleResult>;
}

export interface ChangeRoleResult {
  applied: boolean;
}

export interface ProfileRepo {
  list(teamId: TeamId, membershipId?: MembershipId): Promise<ProfileField[]>;
  upsertField(
    teamId: TeamId,
    field: ProfileField,
    audit: AuditDraft,
  ): Promise<void>;
}

export interface DmSelectionRepo {
  get(telegramUserId: number): Promise<DmSelection | null>;
  set(selection: DmSelection): Promise<void>;
}

// design.md "Interfaces / Contracts" — the crypto adapter (`adapters/crypto`)
// implements this. AAD binds a ciphertext to its table+team+row+field so a
// value copied to another row/tenant fails to decrypt (design.md "Ciphertext
// binding"). Values stay opaque to the domain: callers compute plaintext and
// AAD, adapters own the key material.
export interface FieldCipher {
  encrypt(
    plain: string,
    aad: string,
  ): Promise<{ value: Uint8Array; keyVersion: number }>;
  // Throws FieldUnreadableError on wrong AAD, unknown key version, or any
  // other reason the ciphertext cannot be recovered.
  decrypt(value: Uint8Array, keyVersion: number, aad: string): Promise<string>;
}

export interface ChatAdminChecker {
  // MUST throw (never resolve false-on-error) so callers can distinguish
  // "verified non-admin" from "verification failed".
  isAdmin(chatId: number, userId: number): Promise<boolean>;
}

export interface Clock {
  now(): number;
}

export interface IdGen {
  newId(): string;
}

export interface LogEvent {
  event: string;
  teamId?: string;
  membershipId?: string;
  field?: string;
  outcome: "ok" | "refused" | "error";
  errorCode?: string;
}

export interface Logger {
  log(entry: LogEvent): void;
}
