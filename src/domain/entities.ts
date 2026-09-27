import type { RepoFullName } from "./github";
import type { ExtractedFields } from "./hackathon/extraction";
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

// One repo maps to at most one forum topic per team (design.md "One Topic
// Per Repo, Re-Link Moves It"). `orgLogin` is redundant with the owner
// segment of `repoFullName` but kept as its own column so the composite FK
// to `github_org_claims(team_id, org_login)` can enforce claim ownership at
// the D1 layer without re-parsing the repo name (see migrations/0002).
export interface RepoTopicLink {
  teamId: TeamId;
  repoFullName: RepoFullName;
  orgLogin: string;
  threadId: number;
  createdAt: number;
  updatedAt: number;
}

// --- Hackathon analysis (design.md "Data Flow", "Interfaces / Contracts") ---

// The stored analysis record (design.md "Storage": "the validated
// extraction JSON, bounded; no page text"). `threadId` is the topic it is
// currently linked to, if any (spec hackathon-analysis: "One Analysis Per
// Topic") — set by `linkAnalysisToTopic` (PR4), null for a fresh,
// unlinked analysis.
export interface HackathonAnalysis {
  id: string;
  teamId: TeamId;
  slug: string;
  sourceUrl: string;
  normalizedUrl: string;
  fields: ExtractedFields;
  suggestedRepos: RepoFullName[];
  threadId: number | null;
  // The pinned message id for `threadId`, if pinning succeeded (design.md
  // "Pin Behavior": the link persists even when the pin fails). Null
  // whenever `threadId` is null, or when it is set but the pin attempt
  // failed (link-analysis-to-topic.ts, PR4).
  pinnedMessageId: number | null;
  createdAt: number;
  updatedAt: number;
}

// The queue message (design.md "Message"): ids plus the guarded fetch URL
// only — no user id, username, page content or model output.
export interface AnalysisJobMessage {
  v: 1;
  jobId: string;
  teamId: TeamId;
  chatId: number;
  threadId: number | null;
  fetchUrl: string;
}

export type AnalysisJobStatus =
  | "queued"
  | "running"
  | "persisted"
  | "succeeded"
  | "failed";

// Mirrors migrations/0003_hackathon_analysis.sql's `hackathon_analysis_jobs`
// (design.md "Job State (D1) and Idempotency"). `analysisId` is set once
// the job reaches `persisted` (design.md "Persist"); `failureReason` is a
// fixed, non-sensitive code (design.md "Error Taxonomy"), never set until
// `failed`.
export interface AnalysisJob {
  id: string;
  teamId: TeamId;
  chatId: number;
  threadId: number | null;
  utcDay: string;
  fetchUrl: string;
  status: AnalysisJobStatus;
  attempts: number;
  claimUntil: number;
  analysisId: string | null;
  failureReason: string | null;
  createdAt: number;
  updatedAt: number;
}

// The fields a caller (requestHackathonAnalysis, PR3) supplies to
// `AnalysisQuota.reserve` for the job row it inserts atomically with the
// usage lease (design.md "reserve").
export interface NewAnalysisJob {
  id: string;
  teamId: TeamId;
  chatId: number;
  threadId: number | null;
  utcDay: string;
  fetchUrl: string;
  createdAt: number;
}

// design.md "Job State (D1) and Idempotency" — `claim`'s five outcomes.
export type ClaimResult =
  | { kind: "claimed"; job: AnalysisJob }
  | { kind: "persisted"; job: AnalysisJob }
  | { kind: "terminal" }
  | { kind: "held" }
  | { kind: "missing" };

// design.md "Interfaces / Contracts" — `runHackathonJob`'s (PR3) return
// value; `src/index.ts`'s `queue()` handler maps this to `msg.ack()` or
// `msg.retry()` and never throws.
export type JobOutcome = { kind: "ack" } | { kind: "retry"; delaySeconds: number };
