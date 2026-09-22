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
