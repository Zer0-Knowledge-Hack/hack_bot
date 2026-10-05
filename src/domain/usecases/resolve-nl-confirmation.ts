import type { MembershipId, TeamId } from "../ids";
import {
  NL_CONFIRM_TTL_MS,
  type NlConfirmation,
  type NlMutateIntentId,
} from "../nl/confirmation";
import { matchConfirmLexicon } from "../nl/lexicon";
import type { NlSlots } from "../nl/intents";
import type {
  ChatPublisher,
  Clock,
  IdGen,
  Logger,
  MemberRepo,
  MembershipRepo,
  NlConfirmationRepo,
  TeamRepo,
} from "../ports";
import {
  executeNlMutation,
  mapMutationErrorToCode,
  type ExecuteNlMutationDeps,
} from "./execute-nl-mutation";

export interface ResolveNlConfirmationInput {
  chatId: number;
  callerTelegramUserId: number;
  // One of: callback confirmation id, or reply-to confirm message id.
  confirmationId?: string;
  replyToConfirmMessageId?: number;
  action: "yes" | "cancel";
  callbackMessageId?: number | null;
}

export interface ResolveNlConfirmationCopy {
  cancelled: string;
  busy: string;
  wrongActor: string;
  notMember: string;
  // Fixed Spanish refusals keyed by domain error name (adapter-supplied).
  errorReplies: Record<string, string>;
}

export interface ResolveNlConfirmationDeps extends ExecuteNlMutationDeps {
  teamRepo: TeamRepo;
  memberRepo: MemberRepo;
  membershipRepo: MembershipRepo;
  nlConfirmationRepo: NlConfirmationRepo;
  chatPublisher: ChatPublisher;
  clock: Clock;
  idGen: IdGen;
  logger: Logger;
  copy: ResolveNlConfirmationCopy;
}

export type ResolveNlConfirmationResult =
  | { kind: "ignore" }
  | { kind: "reply"; text: string };

const EVENT = "nl-confirm";

export async function resolveNlConfirmation(
  input: ResolveNlConfirmationInput,
  deps: ResolveNlConfirmationDeps,
): Promise<ResolveNlConfirmationResult> {
  const pending = await loadPending(input, deps);
  if (!pending) {
    return { kind: "reply", text: deps.copy.busy };
  }

  const now = deps.clock.now();
  if (pending.expiresAt <= now || pending.consumedAt !== null) {
    return { kind: "reply", text: deps.copy.busy };
  }

  const member = await deps.memberRepo.findByTelegramUserId(input.callerTelegramUserId);
  if (!member) return { kind: "reply", text: deps.copy.notMember };
  const membership = await deps.membershipRepo.getByMember(pending.teamId, member.id);
  if (!membership) return { kind: "reply", text: deps.copy.notMember };
  if (membership.id !== pending.actorMembershipId) {
    deps.logger.log({
      event: EVENT,
      outcome: "refused",
      errorCode: "WrongActor",
      teamId: pending.teamId,
      reason: pending.intent,
    });
    return { kind: "reply", text: deps.copy.wrongActor };
  }

  if (input.action === "cancel") {
    const cancelled = await deps.nlConfirmationRepo.cancel(pending.id, now);
    if (!cancelled) return { kind: "reply", text: deps.copy.busy };
    await clearConfirmButtons(pending, input.callbackMessageId ?? pending.confirmMessageId, deps);
    deps.logger.log({
      event: EVENT,
      outcome: "ok",
      teamId: pending.teamId,
      reason: `cancel:${pending.intent}`,
    });
    return { kind: "reply", text: deps.copy.cancelled };
  }

  const consumed = await deps.nlConfirmationRepo.tryConsume(pending.id, now);
  if (!consumed) {
    return { kind: "reply", text: deps.copy.busy };
  }

  await clearConfirmButtons(pending, input.callbackMessageId ?? pending.confirmMessageId, deps);

  try {
    const result = await executeNlMutation(
      {
        intent: pending.intent,
        slots: pending.slots,
        teamId: pending.teamId,
        actorMembershipId: pending.actorMembershipId,
        chatId: pending.chatId,
        threadId: pending.threadId,
        callerTelegramUserId: input.callerTelegramUserId,
        callbackMessageId: input.callbackMessageId ?? pending.confirmMessageId,
      },
      deps,
    );
    deps.logger.log({
      event: EVENT,
      outcome: "ok",
      teamId: pending.teamId,
      reason: `yes:${pending.intent}`,
    });
    return { kind: "reply", text: result.replyText };
  } catch (err) {
    const errorCode = mapMutationErrorToCode(err);
    const reply = deps.copy.errorReplies[errorCode];
    if (reply !== undefined) {
      deps.logger.log({
        event: EVENT,
        outcome: "refused",
        errorCode,
        teamId: pending.teamId,
        reason: pending.intent,
      });
      return { kind: "reply", text: reply };
    }
    deps.logger.log({
      event: EVENT,
      outcome: "error",
      errorCode,
      teamId: pending.teamId,
    });
    throw err;
  }
}

async function loadPending(
  input: ResolveNlConfirmationInput,
  deps: ResolveNlConfirmationDeps,
): Promise<NlConfirmation | null> {
  if (input.confirmationId) {
    return deps.nlConfirmationRepo.findById(input.confirmationId);
  }
  if (input.replyToConfirmMessageId !== undefined) {
    return deps.nlConfirmationRepo.findByConfirmMessage(
      input.chatId,
      input.replyToConfirmMessageId,
    );
  }
  return null;
}

async function clearConfirmButtons(
  pending: NlConfirmation,
  messageId: number | null | undefined,
  deps: ResolveNlConfirmationDeps,
): Promise<void> {
  if (messageId == null) return;
  try {
    await deps.chatPublisher.clearButtons(pending.chatId, messageId);
  } catch {
    deps.logger.log({
      event: EVENT,
      outcome: "error",
      errorCode: "ClearButtonsFailed",
      teamId: pending.teamId,
      reason: "clear-buttons-failed",
    });
  }
}

export interface CreateNlConfirmationInput {
  teamId: TeamId;
  chatId: number;
  threadId: number | null;
  actorMembershipId: MembershipId;
  intent: NlMutateIntentId;
  slots: NlSlots;
  confirmText: string;
}

export interface CreateNlConfirmationDeps {
  nlConfirmationRepo: NlConfirmationRepo;
  chatPublisher: ChatPublisher;
  clock: Clock;
  idGen: IdGen;
  logger: Logger;
}

export type CreateNlConfirmationResult =
  | { kind: "done" }
  | { kind: "reply"; text: string };

// Posts the confirm challenge then persists the pending row (design.md sequence).
export async function createNlConfirmation(
  input: CreateNlConfirmationInput,
  deps: CreateNlConfirmationDeps,
): Promise<CreateNlConfirmationResult> {
  const now = deps.clock.now();
  const id = deps.idGen.newId();
  let messageId: number;
  try {
    messageId = await deps.chatPublisher.post(
      input.chatId,
      input.threadId,
      input.confirmText,
      { nlConfirmId: id },
    );
  } catch (err) {
    const errorCode = err instanceof Error ? err.name : "UnknownError";
    deps.logger.log({
      event: "nl-confirm-create",
      outcome: "error",
      errorCode,
      teamId: input.teamId,
      reason: "post-failed",
    });
    return { kind: "reply", text: "No pude enviar la confirmación. Probá de nuevo." };
  }

  await deps.nlConfirmationRepo.create({
    id,
    teamId: input.teamId,
    chatId: input.chatId,
    threadId: input.threadId,
    actorMembershipId: input.actorMembershipId,
    intent: input.intent,
    slots: input.slots,
    confirmMessageId: messageId,
    expiresAt: now + NL_CONFIRM_TTL_MS,
    consumedAt: null,
    createdAt: now,
  });

  deps.logger.log({
    event: "nl-confirm-create",
    outcome: "ok",
    teamId: input.teamId,
    reason: input.intent,
  });
  return { kind: "done" };
}

export function lexiconActionForText(text: string): "yes" | "cancel" | null {
  return matchConfirmLexicon(text);
}
