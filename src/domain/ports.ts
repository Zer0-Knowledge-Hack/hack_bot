import type {
  AnalysisJobMessage,
  AuditDraft,
  ClaimResult,
  HackathonAnalysis,
  Member,
  Membership,
  NewAnalysisJob,
  ProfileField,
  DmSelection,
  RepoTopicLink,
  Team,
} from "./entities";
import type { RepoFullName } from "./github";
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
  // write methods). `actorMembershipId` is required because audit_log.actor_
  // membership_id is a NOT NULL FK (schema) that AuditDraft alone cannot
  // supply — the caller (use case) knows who performed the action.
  bindDataChannel(
    teamId: TeamId,
    threadId: number,
    actorMembershipId: MembershipId,
    audit: AuditDraft,
  ): Promise<void>;
}

export interface MemberRepo {
  findByTelegramUserId(telegramUserId: number): Promise<Member | null>;
  // Idempotent on `telegramUserId` (UNIQUE). MUST return the ACTUALLY
  // persisted member — not the caller-supplied `member` — because a
  // concurrent writer may have already inserted a row for this
  // telegramUserId under a different id between the caller's pre-read and
  // this call (RES-002). Other rows (memberships) FK to member.id, so
  // callers MUST use the returned id, never the locally generated one, for
  // any subsequent write.
  upsert(member: Member): Promise<Member>;
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
  // `actorMembershipId` is required because audit_log.actor_membership_id
  // is a NOT NULL FK (schema) that AuditDraft alone cannot supply — the
  // caller (use case) knows who performed the change. It is intentionally
  // separate from `membershipId` (the target being changed).
  changeRole(
    teamId: TeamId,
    membershipId: MembershipId,
    role: Role,
    actorMembershipId: MembershipId,
    audit: AuditDraft,
    options?: { requireRemainingAdmin: boolean },
  ): Promise<ChangeRoleResult>;
}

export interface ChangeRoleResult {
  applied: boolean;
}

export interface ProfileRepo {
  // MUST isolate a per-field decrypt failure (design.md "PII Never
  // Logged") — one unreadable field (wrong AAD, unknown key version,
  // corrupted ciphertext) MUST NOT fail the whole listing. The broken
  // field is returned with `unreadable: true` and `value: ""` (see
  // `ProfileField.unreadable`), never dropped and never leaking ciphertext.
  list(teamId: TeamId, membershipId?: MembershipId): Promise<ProfileField[]>;
  // `actorMembershipId` is required because audit_log.actor_membership_id is
  // a NOT NULL FK (schema) that AuditDraft alone cannot supply — the caller
  // (use case) knows who performed the edit (self or admin).
  upsertField(
    teamId: TeamId,
    field: ProfileField,
    actorMembershipId: MembershipId,
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
  // A fixed, non-sensitive failure description (e.g. a ConfigError
  // message). Never a raw error message, input value, or secret.
  reason?: string;
}

export interface Logger {
  log(entry: LogEvent): void;
}

// GitHub alerts (design.md "Tenancy for routing" and "Interfaces /
// Contracts"). `findTeamByOrg` is the sole cross-team lookup here —
// mirrors MembershipRepo.findByUser — because routing an inbound webhook
// starts with only an org login, before any TeamId is known. Everything
// after it takes TeamId first.
export interface GithubOrgClaimRepo {
  findTeamByOrg(orgLogin: string): Promise<TeamId | null>;
  isClaimedBy(teamId: TeamId, orgLogin: string): Promise<boolean>;
}

export interface RepoTopicLinkRepo {
  get(teamId: TeamId, repo: RepoFullName): Promise<RepoTopicLink | null>;
  // ON CONFLICT DO UPDATE thread_id (design.md "Interfaces / Contracts") —
  // re-linking an already-linked repo moves it instead of erroring.
  upsert(teamId: TeamId, link: RepoTopicLink): Promise<void>;
  remove(teamId: TeamId, repo: RepoFullName): Promise<boolean>;
  list(teamId: TeamId): Promise<RepoTopicLink[]>;
}

export interface AlertSender {
  // Throws AlertSendFailedError (never resolves false-on-error) so
  // routeGithubEvent can distinguish "delivered" from "send failed" and
  // return the "send-failed" outcome instead of a 500 (design.md "GitHub
  // route status policy").
  send(chatId: number, threadId: number, text: string): Promise<void>;
}

// --- Hackathon analysis ports (design.md "Interfaces / Contracts") ---

// A single instance implements the static path; a second, separate
// instance implements the Browser Rendering fallback (design.md "Ports":
// "PageFetcher (static and rendered instances)"). Throws PageFetchFailedError
// or UnsafeUrlError on failure; the rendered instance also throws
// BrowserQuotaExceededError on a 429 (design.md "A 429 raises
// BrowserQuotaExceededError").
// `signal` carries the per-step timeout derived from the attempt deadline
// (design.md "Time budget": static fetch 10 s, rendered fetch 45 s) — the
// caller (analyzeHackathon) computes it from the injected Clock so the
// adapter never reads the wall clock itself.
export interface PageFetcher {
  fetch(url: string, signal: AbortSignal): Promise<string>;
}

// Throws ExtractionFailedError or LlmQuotaExceededError. Otherwise returns
// the model's raw parsed JSON output — `validateExtraction` (the ONLY
// place a raw model response is trusted, hackathon/extraction.ts) decides
// whether it is usable. `signal` carries the per-attempt LLM timeout
// (design.md "Time budget": 45 s per LLM attempt).
export interface LlmExtractor {
  extract(pageText: string, modelId: string, signal: AbortSignal): Promise<unknown>;
}

export interface HackathonAnalysisRepo {
  findBySlug(teamId: TeamId, slug: string): Promise<HackathonAnalysis | null>;
  // Used by the persisted-redelivery path (design.md "Post then mark") to
  // repost the exact analysis the job produced, instead of re-deriving it
  // by URL (RELI-002).
  findById(teamId: TeamId, id: string): Promise<HackathonAnalysis | null>;
  findByNormalizedUrl(
    teamId: TeamId,
    normalizedUrl: string,
  ): Promise<HackathonAnalysis | null>;
  slugExists(teamId: TeamId, slug: string): Promise<boolean>;
  // Insert-or-update by `id` (design.md "Same-URL Refresh Keeps the Slug" —
  // a refresh reuses the existing row's id and slug).
  save(analysis: HackathonAnalysis): Promise<void>;
}

// design.md "reserve": one atomic batch reserves the cap slot and the
// team lease together with the job insert, so a redelivery cannot
// double-count (design.md "Cap and lease"). `release` is owner-checked by
// `jobId`; `refund` only decrements `runs` (spec: "Enqueue failure",
// "job expired").
export interface AnalysisQuota {
  reserve(input: {
    team: TeamId;
    day: string;
    cap: number;
    now: number;
    leaseMs: number;
    job: NewAnalysisJob;
  }): Promise<"ok" | "busy" | "cap-reached">;
  release(
    team: TeamId,
    day: string,
    jobId: string,
    refund: boolean,
  ): Promise<void>;
}

// design.md "Job State (D1) and Idempotency". `markPersisted` records the
// analysis id produced by the persist step; `markSucceeded`/`markFailed`
// are the two terminal transitions.
export interface AnalysisJobRepo {
  claim(id: string, now: number): Promise<ClaimResult>;
  markPersisted(id: string, analysisId: string): Promise<void>;
  markSucceeded(id: string): Promise<void>;
  markFailed(id: string, reason: string): Promise<void>;
}

// Throws QueueSendFailedError (design.md "Interfaces / Contracts").
export interface AnalysisJobQueue {
  enqueue(message: AnalysisJobMessage): Promise<void>;
}

// Public GitHub repo metadata used to enrich a suggested repo (design.md
// "Data Flow": "repoLinks+metadata"). The adapter (src/adapters/github/
// repo-metadata.ts, PR8) is the only implementation; wiring this into
// analyzeHackathon is deferred past PR2 (see apply-progress deviations).
export interface RepoMetadataSource {
  fetchDescription(repo: RepoFullName): Promise<string | null>;
}

// design.md "Interfaces / Contracts". `post` returns the new message id
// (needed to `pin`/`unpin` it later) and throws PublishFailedError on
// failure, mirroring AlertSender.
export interface ChatPublisher {
  post(chatId: number, threadId: number | null, text: string): Promise<number>;
  pin(chatId: number, messageId: number): Promise<void>;
  unpin(chatId: number, messageId: number): Promise<void>;
}
