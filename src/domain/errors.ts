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
// Thrown by an AlertSender implementation when the underlying send fails
// (e.g. Telegram rejects the request because the topic was deleted).
// route-github-event.ts catches this specific error and returns a
// "send-failed" outcome instead of letting it propagate (design.md
// "GitHub route status policy").
export class AlertSendFailedError extends DomainError {}
// Thrown when a tenant-scoped write's explicit `teamId` argument disagrees
// with the `teamId` embedded in the entity being written (e.g.
// RepoTopicLinkRepo.upsert). The explicit argument is always authoritative
// (design.md/ports.ts "Tenancy": every tenant-scoped method takes TeamId
// first) — this is a caller bug, never a silent cross-tenant write.
export class TenantMismatchError extends DomainError {}
