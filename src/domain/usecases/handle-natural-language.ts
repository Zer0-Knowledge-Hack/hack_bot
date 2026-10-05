import type { Membership, ProfileField, RepoTopicLink } from "../entities";
import {
  AnalysisNotFoundError,
  ConfigError,
  IntentClassificationError,
  LlmQuotaExceededError,
  NotFoundError,
  UnauthorizedError,
} from "../errors";
import { asMembershipId, type MembershipId, type TeamId } from "../ids";
import { confirmSummaryFor, type NlConfirmSummaries } from "../nl/confirm-summary";
import { isNlMutateIntentId, type NlMutateIntentId } from "../nl/confirmation";
import {
  confidenceBucket,
  NL_CLASSIFY_DAILY_CAP,
  NL_CLASSIFY_TIMEOUT_MS,
  utcDayOf,
  type IntentResult,
  type NlIntentId,
  type NlSlots,
} from "../nl/intents";
import { matchConfirmLexicon } from "../nl/lexicon";
import type {
  ChatPublisher,
  Clock,
  GithubOrgClaimRepo,
  HackathonAnalysisRepo,
  IdGen,
  IntentClassifier,
  Logger,
  MemberRepo,
  MembershipRepo,
  NlClassifyQuota,
  NlConfirmationRepo,
  ProfileRepo,
  RepoTopicLinkRepo,
  TeamRepo,
} from "../ports";
import { listAnalyses } from "./list-analyses";
import { listRepoLinks } from "./list-repo-links";
import { readProfiles } from "./read-profiles";
import {
  createNlConfirmation,
  resolveNlConfirmation,
  type ResolveNlConfirmationCopy,
  type ResolveNlConfirmationDeps,
} from "./resolve-nl-confirmation";
import { showAnalysis } from "./show-analysis";
import { showTopicAnalysis } from "./show-topic-analysis";

export interface NlCopyBag {
  help: string;
  unknown: string;
  notConfigured: string;
  classifyFailed: string;
  quota: string;
  notMember: string;
  clarifySlug: string;
  clarifyTopic: string;
  noTopicAnalysis: string;
  noAnalysis: string;
  dataChannelOnly: string;
  profileDataChannelOnly: string;
  clarifyMembership: string;
  clarifyRepo: string;
  clarifyUrl: string;
  clarifyThread: string;
  lexiconHint: string;
  confirmPrompt: (summary: string) => string;
  confirmSummaries: NlConfirmSummaries;
  resolveCopy: ResolveNlConfirmationCopy;
}

export interface HandleNaturalLanguageInput {
  chatId: number;
  threadId: number | null;
  callerTelegramUserId: number;
  classifiedText: string;
  // When the user replied to a bot message — used for confirm lexicon path.
  replyToMessageId?: number | null;
  // When the user replied to another user — promote/demote target hint.
  replyFromUserId?: number | null;
}

export interface HandleNaturalLanguageDeps extends Omit<ResolveNlConfirmationDeps, "copy"> {
  teamRepo: TeamRepo;
  memberRepo: MemberRepo;
  membershipRepo: MembershipRepo;
  profileRepo: ProfileRepo;
  hackathonAnalysisRepo: HackathonAnalysisRepo;
  repoTopicLinkRepo: RepoTopicLinkRepo;
  githubOrgClaimRepo: GithubOrgClaimRepo;
  nlClassifyQuota: NlClassifyQuota;
  nlConfirmationRepo: NlConfirmationRepo;
  intentClassifier: IntentClassifier;
  chatPublisher: ChatPublisher;
  clock: Clock;
  idGen: IdGen;
  logger: Logger;
  nlModelPrimary: string;
  copy: NlCopyBag;
  formatRepoLinks: (links: RepoTopicLink[]) => string;
  formatProfiles: (
    memberships: Membership[],
    fields: ProfileField[],
    teamId: TeamId,
  ) => string;
}

export type HandleNaturalLanguageResult =
  | { kind: "ignore" }
  | { kind: "done" }
  | { kind: "reply"; text: string };

const EVENT = "nl-handle";

export async function handleNaturalLanguage(
  input: HandleNaturalLanguageInput,
  deps: HandleNaturalLanguageDeps,
): Promise<HandleNaturalLanguageResult> {
  const team = await deps.teamRepo.findByChatId(input.chatId);
  if (!team) return { kind: "ignore" };

  const member = await deps.memberRepo.findByTelegramUserId(input.callerTelegramUserId);
  if (!member) return { kind: "reply", text: deps.copy.notMember };
  const membership = await deps.membershipRepo.getByMember(team.id, member.id);
  if (!membership) return { kind: "reply", text: deps.copy.notMember };

  // Reply-to-confirm: lexicon path, no classify / no quota (design.md step 5).
  if (input.replyToMessageId != null) {
    const pending = await deps.nlConfirmationRepo.findByConfirmMessage(
      input.chatId,
      input.replyToMessageId,
    );
    if (pending) {
      const action = matchConfirmLexicon(input.classifiedText);
      if (!action) {
        return { kind: "reply", text: deps.copy.lexiconHint };
      }
      return resolveNlConfirmation(
        {
          chatId: input.chatId,
          callerTelegramUserId: input.callerTelegramUserId,
          confirmationId: pending.id,
          action,
          callbackMessageId: pending.confirmMessageId,
        },
        { ...deps, copy: deps.copy.resolveCopy },
      );
    }
  }

  const modelId = deps.nlModelPrimary.trim();
  if (modelId === "") {
    deps.logger.log({
      event: EVENT,
      outcome: "refused",
      errorCode: "ConfigError",
      teamId: team.id,
      reason: "nl-not-configured",
    });
    return { kind: "reply", text: deps.copy.notConfigured };
  }

  const dayUtc = utcDayOf(deps.clock.now());
  const reserved = await deps.nlClassifyQuota.reserve(
    team.id,
    dayUtc,
    NL_CLASSIFY_DAILY_CAP,
  );
  if (!reserved) {
    deps.logger.log({
      event: EVENT,
      outcome: "refused",
      errorCode: "NlQuotaReached",
      teamId: team.id,
      reason: "nl-quota",
    });
    return { kind: "reply", text: deps.copy.quota };
  }

  const inDataChannel =
    team.dataTopicThreadId !== null && input.threadId === team.dataTopicThreadId;
  const signal = AbortSignal.timeout(NL_CLASSIFY_TIMEOUT_MS);

  let classified: IntentResult;
  try {
    classified = await deps.intentClassifier.classify(
      {
        text: input.classifiedText,
        localeHint: "es",
        context: {
          inTopic: input.threadId !== null,
          inDataChannel,
          replyKind: "none",
        },
      },
      signal,
    );
  } catch (err) {
    return mapClassifyError(err, team.id, deps);
  }

  deps.logger.log({
    event: EVENT,
    outcome: "ok",
    teamId: team.id,
    reason: `intent:${classified.intent}:${confidenceBucket(classified.confidence)}`,
  });

  return dispatchIntent(classified, {
    teamId: team.id,
    actorMembershipId: membership.id,
    chatId: input.chatId,
    threadId: input.threadId,
    callerTelegramUserId: input.callerTelegramUserId,
    inDataChannel,
    replyFromUserId: input.replyFromUserId ?? null,
  }, deps);
}

function mapClassifyError(
  err: unknown,
  teamId: TeamId,
  deps: HandleNaturalLanguageDeps,
): HandleNaturalLanguageResult {
  const errorCode = err instanceof Error ? err.name : "UnknownError";
  if (err instanceof ConfigError) {
    deps.logger.log({
      event: EVENT,
      outcome: "refused",
      errorCode,
      teamId,
      reason: "nl-not-configured",
    });
    return { kind: "reply", text: deps.copy.notConfigured };
  }
  if (err instanceof LlmQuotaExceededError || err instanceof IntentClassificationError) {
    deps.logger.log({
      event: EVENT,
      outcome: "refused",
      errorCode,
      teamId,
      reason: "classify-failed",
    });
    return { kind: "reply", text: deps.copy.classifyFailed };
  }
  deps.logger.log({ event: EVENT, outcome: "error", errorCode, teamId });
  throw err;
}

interface DispatchCtx {
  teamId: TeamId;
  actorMembershipId: MembershipId;
  chatId: number;
  threadId: number | null;
  callerTelegramUserId: number;
  inDataChannel: boolean;
  replyFromUserId: number | null;
}

async function dispatchIntent(
  classified: IntentResult,
  ctx: DispatchCtx,
  deps: HandleNaturalLanguageDeps,
): Promise<HandleNaturalLanguageResult> {
  const { intent, slots } = classified;

  if (intent === "help") return { kind: "reply", text: deps.copy.help };
  if (intent === "unknown") return { kind: "reply", text: deps.copy.unknown };

  if (isNlMutateIntentId(intent)) {
    return dispatchMutate(intent, slots, ctx, deps);
  }

  try {
    switch (intent) {
      case "list_hackathons": {
        const result = await listAnalyses(
          { teamId: ctx.teamId, actorMembershipId: ctx.actorMembershipId },
          deps,
        );
        return { kind: "reply", text: result.replyText };
      }
      case "show_hackathon":
        return await showHackathon(slots, ctx, deps);
      case "show_topic_hackathon":
        return await showTopic(ctx, deps);
      case "list_repos": {
        const links = await listRepoLinks(
          { teamId: ctx.teamId, actorMembershipId: ctx.actorMembershipId },
          deps,
        );
        return { kind: "reply", text: deps.formatRepoLinks(links) };
      }
      case "show_profiles":
        return await showProfiles(slots, ctx, deps);
      default:
        return { kind: "reply", text: deps.copy.unknown };
    }
  } catch (err) {
    return mapReadError(err, intent, ctx.teamId, deps);
  }
}

async function dispatchMutate(
  intent: NlMutateIntentId,
  slots: NlSlots,
  ctx: DispatchCtx,
  deps: HandleNaturalLanguageDeps,
): Promise<HandleNaturalLanguageResult> {
  if (intent === "set_profile_field" && !ctx.inDataChannel) {
    return { kind: "reply", text: deps.copy.profileDataChannelOnly };
  }

  const resolvedSlots = await resolveMutateSlots(intent, slots, ctx, deps);
  if (resolvedSlots.kind === "clarify") {
    return { kind: "reply", text: resolvedSlots.text };
  }

  const summary = confirmSummaryFor(intent, resolvedSlots.slots, deps.copy.confirmSummaries);
  if (!summary) {
    return { kind: "reply", text: deps.copy.unknown };
  }

  // Never put profileValue into confirm text (only slots_json after create).
  return createNlConfirmation(
    {
      teamId: ctx.teamId,
      chatId: ctx.chatId,
      threadId: ctx.threadId,
      actorMembershipId: ctx.actorMembershipId,
      intent,
      slots: resolvedSlots.slots,
      confirmText: deps.copy.confirmPrompt(summary),
    },
    deps,
  );
}

type ResolveSlotsResult =
  | { kind: "ok"; slots: NlSlots }
  | { kind: "clarify"; text: string };

async function resolveMutateSlots(
  intent: NlMutateIntentId,
  slots: NlSlots,
  ctx: DispatchCtx,
  deps: HandleNaturalLanguageDeps,
): Promise<ResolveSlotsResult> {
  switch (intent) {
    case "setup_team":
    case "join_team":
      return { kind: "ok", slots };
    case "bind_data_channel":
      if (ctx.threadId === null) return { kind: "clarify", text: deps.copy.clarifyThread };
      return { kind: "ok", slots };
    case "set_profile_field":
      if (!slots.profileField || slots.profileValue === undefined) {
        return { kind: "clarify", text: deps.copy.unknown };
      }
      return { kind: "ok", slots };
    case "promote_member":
    case "demote_member": {
      if (slots.membershipId) return { kind: "ok", slots };
      if (ctx.replyFromUserId != null) {
        const targetMember = await deps.memberRepo.findByTelegramUserId(ctx.replyFromUserId);
        if (!targetMember) return { kind: "clarify", text: deps.copy.clarifyMembership };
        const targetMembership = await deps.membershipRepo.getByMember(
          ctx.teamId,
          targetMember.id,
        );
        if (!targetMembership) return { kind: "clarify", text: deps.copy.clarifyMembership };
        return {
          kind: "ok",
          slots: { ...slots, membershipId: targetMembership.id },
        };
      }
      return { kind: "clarify", text: deps.copy.clarifyMembership };
    }
    case "link_repo":
      if (ctx.threadId === null) return { kind: "clarify", text: deps.copy.clarifyThread };
      if (!slots.repo) return { kind: "clarify", text: deps.copy.clarifyRepo };
      return { kind: "ok", slots };
    case "unlink_repo":
      if (!slots.repo) return { kind: "clarify", text: deps.copy.clarifyRepo };
      return { kind: "ok", slots };
    case "link_hackathon_topic":
      if (ctx.threadId === null) return { kind: "clarify", text: deps.copy.clarifyThread };
      if (!slots.slug) return { kind: "clarify", text: deps.copy.clarifySlug };
      return { kind: "ok", slots };
    case "request_hackathon_analysis":
      if (!slots.url) return { kind: "clarify", text: deps.copy.clarifyUrl };
      return { kind: "ok", slots };
    case "participate_hackathon":
      if (!slots.slug) return { kind: "clarify", text: deps.copy.clarifySlug };
      return { kind: "ok", slots };
    default: {
      const _exhaustive: never = intent;
      return _exhaustive;
    }
  }
}

async function showHackathon(
  slots: NlSlots,
  ctx: DispatchCtx,
  deps: HandleNaturalLanguageDeps,
): Promise<HandleNaturalLanguageResult> {
  const slug = slots.slug?.trim();
  if (!slug) return { kind: "reply", text: deps.copy.clarifySlug };
  const result = await showAnalysis(
    { teamId: ctx.teamId, actorMembershipId: ctx.actorMembershipId, slug },
    deps,
  );
  return { kind: "reply", text: result.replyText };
}

async function showTopic(
  ctx: DispatchCtx,
  deps: HandleNaturalLanguageDeps,
): Promise<HandleNaturalLanguageResult> {
  if (ctx.threadId === null) return { kind: "reply", text: deps.copy.clarifyTopic };
  const result = await showTopicAnalysis(
    {
      teamId: ctx.teamId,
      actorMembershipId: ctx.actorMembershipId,
      threadId: ctx.threadId,
    },
    deps,
  );
  return {
    kind: "reply",
    text: result?.replyText ?? deps.copy.noTopicAnalysis,
  };
}

async function showProfiles(
  slots: NlSlots,
  ctx: DispatchCtx,
  deps: HandleNaturalLanguageDeps,
): Promise<HandleNaturalLanguageResult> {
  const targetMembershipId = slots.membershipId
    ? asMembershipId(slots.membershipId)
    : undefined;
  const fields = await readProfiles(
    {
      context: {
        kind: "group",
        chatId: ctx.chatId,
        threadId: ctx.threadId,
      },
      callerTelegramUserId: ctx.callerTelegramUserId,
      targetMembershipId,
    },
    deps,
  );
  const memberships = targetMembershipId
    ? await deps.membershipRepo.get(ctx.teamId, targetMembershipId).then((m) => (m ? [m] : []))
    : await deps.membershipRepo.listByTeam(ctx.teamId);
  return {
    kind: "reply",
    text: deps.formatProfiles(memberships, fields, ctx.teamId),
  };
}

function mapReadError(
  err: unknown,
  intent: NlIntentId,
  teamId: TeamId,
  deps: HandleNaturalLanguageDeps,
): HandleNaturalLanguageResult {
  const errorCode = err instanceof Error ? err.name : "UnknownError";
  if (err instanceof UnauthorizedError) {
    deps.logger.log({
      event: EVENT,
      outcome: "refused",
      errorCode,
      teamId,
      reason: `intent:${intent}`,
    });
    return { kind: "reply", text: deps.copy.dataChannelOnly };
  }
  if (err instanceof NotFoundError) {
    deps.logger.log({
      event: EVENT,
      outcome: "refused",
      errorCode,
      teamId,
      reason: `intent:${intent}`,
    });
    return { kind: "reply", text: deps.copy.notMember };
  }
  if (err instanceof AnalysisNotFoundError) {
    deps.logger.log({
      event: EVENT,
      outcome: "refused",
      errorCode,
      teamId,
      reason: `intent:${intent}`,
    });
    return { kind: "reply", text: deps.copy.noAnalysis };
  }
  deps.logger.log({ event: EVENT, outcome: "error", errorCode, teamId });
  throw err;
}
