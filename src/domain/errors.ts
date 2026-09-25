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
