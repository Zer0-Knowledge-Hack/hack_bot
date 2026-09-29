// Reused, not duplicated: ConfigError already exists at src/config-error.ts
// (used by adapters/github/signature.ts, adapters/crypto/key-ring.ts and
// composition.ts). Re-exporting the SAME class here keeps `instanceof`
// checks working across every caller, domain or adapter, instead of
// forking two classes with the same name (design.md "Config errors").
export { ConfigError } from "../config-error";
import type { FieldRejection } from "./hackathon/extraction";

export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class UnauthorizedError extends DomainError {}
export class NotFoundError extends DomainError {}
export class AlreadyExistsError extends DomainError {}
export class LastAdminError extends DomainError {}
export class ChatAdminCheckFailedError extends DomainError {}
export class DmSelectionRequiredError extends DomainError {}
export class FieldUnreadableError extends DomainError {}
export class InvalidRepoError extends DomainError {}
export class OrgNotClaimedError extends DomainError {}
// A fixed, non-sensitive classification of why a send failed — never
// Telegram's error description, the chat id, or the token (design.md
// "Logging"; PR4 correction RES-001). "rate-limited" is a 429, "rejected"
// is any other 4xx (e.g. the topic was deleted), "telegram-unavailable" is
// a 5xx or a network/transport failure (grammY's HttpError). All three are
// still a permanent-for-this-request delivery failure per the spec ("no
// retry within the same request") — the classification only changes what
// is logged, never the 2xx/no-retry behavior.
export type AlertSendFailureClass =
  | "rate-limited"
  | "rejected"
  | "telegram-unavailable";

// Thrown by an AlertSender implementation when the underlying send fails
// (e.g. Telegram rejects the request because the topic was deleted).
// route-github-event.ts catches this specific error and returns a
// "send-failed" outcome instead of letting it propagate (design.md
// "GitHub route status policy").
export class AlertSendFailedError extends DomainError {
  readonly failureClass: AlertSendFailureClass;

  constructor(message: string, failureClass: AlertSendFailureClass) {
    super(message);
    this.failureClass = failureClass;
  }
}
// Thrown when a tenant-scoped write's explicit `teamId` argument disagrees
// with the `teamId` embedded in the entity being written (e.g.
// RepoTopicLinkRepo.upsert). The explicit argument is always authoritative
// (design.md/ports.ts "Tenancy": every tenant-scoped method takes TeamId
// first) — this is a caller bug, never a silent cross-tenant write.
export class TenantMismatchError extends DomainError {}

// --- Hackathon analysis errors (design.md "Error Taxonomy") ---

// Thrown by a PageFetcher/rendered-fetcher adapter when the URL, a
// redirect hop or a browser sub-request fails the SSRF guard (spec
// page-fetch: "Scheme and Destination Guard on the Static Path", "Same
// Guard Applies to the Browser Fallback"). `reason` mirrors
// hackathon/url.ts's UnsafeUrlReason so the log entry stays a fixed,
// non-sensitive code (design.md "No Raw Page Stored or Logged").
export class UnsafeUrlError extends DomainError {
  readonly reason: string;

  constructor(message: string, reason: string) {
    super(message);
    this.reason = reason;
  }
}

// A static or rendered fetch failed for a reason other than the SSRF guard
// or a quota (design.md "Error Taxonomy": `fetch:{timeout,too-large,
// http-status,content-type,redirects,network}`).
export type PageFetchFailureKind =
  | "timeout"
  | "too-large"
  | "http-status"
  | "content-type"
  | "redirects"
  | "network";

export class PageFetchFailedError extends DomainError {
  readonly kind: PageFetchFailureKind;
  // The non-2xx HTTP status; set only when `kind` is "http-status". A bare
  // number (never the URL or body) so it is safe to log.
  readonly status?: number;

  constructor(message: string, kind: PageFetchFailureKind, status?: number) {
    super(message);
    this.kind = kind;
    if (status !== undefined) this.status = status;
  }
}

// The final page text (static, or static-plus-rendered) is below the
// usable-text floor (design.md "Error Taxonomy": `fetch:too-thin[
// -browser-quota]`). `browserQuotaDegraded` is set when the shortfall
// followed a Browser Rendering 429 with too little static text to
// substitute (spec page-fetch: "Browser Rendering returns 429 with
// insufficient static text").
export class PageTooThinError extends DomainError {
  readonly browserQuotaDegraded: boolean;

  constructor(message: string, browserQuotaDegraded = false) {
    super(message);
    this.browserQuotaDegraded = browserQuotaDegraded;
  }
}

// Browser Rendering responded with a quota-exhausted status (429). Thrown
// only by the rendered PageFetcher instance (design.md "A 429 raises
// BrowserQuotaExceededError") — analyzeHackathon decides whether to
// degrade to the static text or fail based on its length.
export class BrowserQuotaExceededError extends DomainError {}

// Both the primary and the fallback model produced an unusable response
// (design.md "Error Taxonomy": `llm:{invalid-output,model-error,
// timeout}`).
export type ExtractionFailureKind = "invalid-output" | "model-error" | "timeout";

// One model attempt's outcome, for post-mortem logging only. Carries field
// NAMES and fixed reason codes — never snippet text, values or page content.
// Why a model's text did not parse as a JSON object. Fixed codes only.
export type LlmParseFailureCode =
  | "no-content" // null, missing or empty content
  | "unterminated" // has a "{" but no matching closing "}" (truncated)
  | "prose-around" // a parsable JSON object exists, wrapped in other text
  | "control-chars" // parsed only after escaping raw TAB/CR/LF inside string literals
  | "not-json" // no JSON object in the text
  | "non-object"; // valid JSON, but not an object (array, number, ...)

export const LLM_PARSE_FAILURE_CODES: readonly LlmParseFailureCode[] = [
  "no-content",
  "unterminated",
  "prose-around",
  "control-chars",
  "not-json",
  "non-object",
];

export interface ExtractionAttemptDiagnostics {
  model: string;
  // true ONLY when the model's text was parsed as JSON (possibly after
  // tolerant recovery). It says nothing about whether the shape validated.
  parsed: boolean;
  // "invalid" when JSON parsed but the top level failed validation as a
  // whole (not a plain object). Absent otherwise; per-field shape problems
  // show up in `rejected` with reason "wrong-shape" instead.
  shape?: "invalid";
  rejectedCount: number;
  rejected: FieldRejection[];
  // Parse metadata (numbers and fixed codes only — never model content).
  finishReason?: string;
  contentLength?: number;
  parseFailure?: LlmParseFailureCode;
  // true when parseFailure was reported but the object was still recovered.
  recovered?: boolean;
}

export class ExtractionFailedError extends DomainError {
  readonly kind: ExtractionFailureKind;
  readonly attempts?: ExtractionAttemptDiagnostics[];

  constructor(
    message: string,
    kind: ExtractionFailureKind,
    attempts?: ExtractionAttemptDiagnostics[],
  ) {
    super(message);
    this.kind = kind;
    if (attempts !== undefined) this.attempts = attempts;
  }
}

// The shared Workers AI daily quota is exhausted (design.md "Error
// Taxonomy": `llm:quota`). Never retried within the same job.
export class LlmQuotaExceededError extends DomainError {}

// `AnalysisJobQueue.enqueue` failed (design.md "Error Taxonomy":
// `queue:send-failed`). The caller (requestHackathonAnalysis, PR3) refunds
// the reserved cap slot on this error.
export class QueueSendFailedError extends DomainError {}

// A fresh analysis job for the team is already queued or running (spec
// hackathon-analysis: "Analysis already running"). No cap slot is
// consumed.
export class AnalysisBusyError extends DomainError {}

// The team's daily cap of fresh runs is already reached (spec
// hackathon-analysis: "Cap reached", "Daily Cap on Fresh Runs").
export class DailyCapReachedError extends DomainError {}

// No stored analysis exists under the requested slug (spec
// hackathon-analysis: `/hackathon <slug>` re-show, `showAnalysis`, PR4).
export class AnalysisNotFoundError extends DomainError {}

// Thrown by a ChatPublisher implementation when `post`/`pin`/`unpin` fails
// (design.md "Interfaces / Contracts": "post throws
// PublishFailedError(AlertSendFailureClass)"). Mirrors AlertSendFailedError
// exactly — same three non-sensitive failure classes, same "still a
// permanent-for-this-request failure" contract.
export class PublishFailedError extends DomainError {
  readonly failureClass: AlertSendFailureClass;

  constructor(message: string, failureClass: AlertSendFailureClass) {
    super(message);
    this.failureClass = failureClass;
  }
}
