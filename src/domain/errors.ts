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
