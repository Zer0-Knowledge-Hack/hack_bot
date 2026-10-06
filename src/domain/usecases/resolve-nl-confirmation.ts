import type { MembershipId, TeamId } from "../ids";
import {
  NL_CONFIRM_TTL_MS,
  type NlConfirmation,
  type NlMutateIntentId,
} from "../nl/confirmation";
import { confirmSummaryFor, type NlConfirmSummaries } from "../nl/confirm-summary";
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
  // Shown after CAS consume when the mutate fails with an unmapped error —
  // never leave the user with cleared buttons and no reply.
  executeFailed: string;
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
  | { kind: "done" }
  | { kind: "reply"; text: string };

const EVENT = "nl-confirm";

export async function resolveNlConfirmation(
  input: ResolveNlConfirmationInput,
  deps: ResolveNlConfirmationDeps,
): Promise<ResolveNlConfirmationResult> {
  const pending = await loadPending(input, deps);
  if (!pending || pending.chatId !== input.chatId) {
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

  // A pick row must be resolved via nl:p before Confirm/sí.
  if ((pending.slots.pickSlugs?.length ?? 0) > 0 && !pending.slots.slug) {
    return { kind: "reply", text: deps.copy.busy };
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
    // Confirmation is already consumed — always reply so the user is not stuck
    // with cleared buttons and a silent webhook 200.
    const errorCode = mapMutationErrorToCode(err);
    const mapped = deps.copy.errorReplies[errorCode];
    const reply = mapped ?? deps.copy.executeFailed;
    deps.logger.log({
      event: EVENT,
      outcome: mapped !== undefined ? "refused" : "error",
      errorCode,
      teamId: pending.teamId,
      reason: pending.intent,
    });
    return { kind: "reply", text: reply };
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

export interface CreateNlDisambiguationInput {
  teamId: TeamId;
  chatId: number;
  threadId: number | null;
  actorMembershipId: MembershipId;
  intent: NlMutateIntentId;
  // Ordered slugs shown as buttons (labels parallel).
  pickSlugs: string[];
  labels: string[];
  promptText: string;
}

// Posts a multi-choice keyboard; picking one upgrades the row into a normal
// confirm (see resolveNlPick).
export async function createNlDisambiguation(
  input: CreateNlDisambiguationInput,
  deps: CreateNlConfirmationDeps,
): Promise<CreateNlConfirmationResult> {
  if (input.pickSlugs.length === 0 || input.pickSlugs.length !== input.labels.length) {
    return { kind: "reply", text: "No pude armar las opciones. Probá de nuevo." };
  }
  const now = deps.clock.now();
  const id = deps.idGen.newId();
  let messageId: number;
  try {
    messageId = await deps.chatPublisher.post(input.chatId, input.threadId, input.promptText, {
      nlPick: { confirmId: id, labels: input.labels },
    });
  } catch (err) {
    const errorCode = err instanceof Error ? err.name : "UnknownError";
    deps.logger.log({
      event: "nl-pick-create",
      outcome: "error",
      errorCode,
      teamId: input.teamId,
      reason: "post-failed",
    });
    return { kind: "reply", text: "No pude enviar las opciones. Probá de nuevo." };
  }

  await deps.nlConfirmationRepo.create({
    id,
    teamId: input.teamId,
    chatId: input.chatId,
    threadId: input.threadId,
    actorMembershipId: input.actorMembershipId,
    intent: input.intent,
    slots: { pickSlugs: input.pickSlugs },
    confirmMessageId: messageId,
    expiresAt: now + NL_CONFIRM_TTL_MS,
    consumedAt: null,
    createdAt: now,
  });

  deps.logger.log({
    event: "nl-pick-create",
    outcome: "ok",
    teamId: input.teamId,
    reason: input.intent,
  });
  return { kind: "done" };
}

export interface ResolveNlPickInput {
  chatId: number;
  callerTelegramUserId: number;
  confirmationId: string;
  pickIndex: number;
  callbackMessageId: number | null;
}

export type ResolveNlPickDeps = ResolveNlConfirmationDeps & {
  confirmPrompt: (summary: string) => string;
  confirmSummaries: NlConfirmSummaries;
};

// Turns a pending pick into a Confirm/Cancel challenge for the chosen slug.
export async function resolveNlPick(
  input: ResolveNlPickInput,
  deps: ResolveNlPickDeps,
): Promise<ResolveNlConfirmationResult> {
  const pending = await deps.nlConfirmationRepo.findById(input.confirmationId);
  if (!pending || pending.chatId !== input.chatId) {
    return { kind: "reply", text: deps.copy.busy };
  }
  const now = deps.clock.now();
  if (pending.consumedAt !== null || pending.expiresAt <= now) {
    return { kind: "reply", text: deps.copy.busy };
  }

  const member = await deps.memberRepo.findByTelegramUserId(input.callerTelegramUserId);
  if (!member) return { kind: "reply", text: deps.copy.notMember };
  const callerMembership = await deps.membershipRepo.getByMember(pending.teamId, member.id);
  if (!callerMembership) return { kind: "reply", text: deps.copy.notMember };
  if (callerMembership.id !== pending.actorMembershipId) {
    return { kind: "reply", text: deps.copy.wrongActor };
  }

  const pickSlugs = pending.slots.pickSlugs ?? [];
  const slug = pickSlugs[input.pickIndex];
  if (!slug) return { kind: "reply", text: deps.copy.busy };

  const nextSlots: NlSlots = { slug };
  const summary = confirmSummaryFor(pending.intent, nextSlots, deps.confirmSummaries);
  if (!summary) return { kind: "reply", text: deps.copy.busy };

  const confirmText = deps.confirmPrompt(summary);
  const messageId = pending.confirmMessageId ?? input.callbackMessageId;
  if (messageId !== null) {
    try {
      await deps.chatPublisher.editMessage(pending.chatId, messageId, confirmText, {
        nlConfirmId: pending.id,
      });
      // Persist the chosen slug only after the message is a Confirm/Cancel
      // challenge — otherwise a failed edit + createNlConfirmation left two
      // confirmable rows (double execute).
      await deps.nlConfirmationRepo.updateSlots(pending.id, nextSlots);
    } catch {
      try {
        await deps.chatPublisher.clearButtons(pending.chatId, messageId);
      } catch {
        /* ignore */
      }
      // Retire the pick row so sí / nl:ok cannot race a second mutate.
      await deps.nlConfirmationRepo.cancel(pending.id, now);
      return createNlConfirmation(
        {
          teamId: pending.teamId,
          chatId: pending.chatId,
          threadId: pending.threadId,
          actorMembershipId: pending.actorMembershipId,
          intent: pending.intent,
          slots: nextSlots,
          confirmText,
        },
        deps,
      );
    }
  } else {
    await deps.nlConfirmationRepo.updateSlots(pending.id, nextSlots);
  }

  deps.logger.log({
    event: "nl-pick",
    outcome: "ok",
    teamId: pending.teamId,
    reason: pending.intent,
  });
  return { kind: "done" };
}

export function lexiconActionForText(text: string): "yes" | "cancel" | null {
  return matchConfirmLexicon(text);
}

