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
import {
  confidenceBucket,
  NL_CLASSIFY_DAILY_CAP,
  NL_CLASSIFY_TIMEOUT_MS,
  NL_MUTATE_INTENTS,
  utcDayOf,
  type IntentResult,
  type NlIntentId,
  type NlSlots,
} from "../nl/intents";
import type {
  Clock,
  GithubOrgClaimRepo,
  HackathonAnalysisRepo,
  IntentClassifier,
  Logger,
  MemberRepo,
  MembershipRepo,
  NlClassifyQuota,
  ProfileRepo,
  RepoTopicLinkRepo,
  TeamRepo,
} from "../ports";
import { listAnalyses } from "./list-analyses";
import { listRepoLinks } from "./list-repo-links";
import { readProfiles } from "./read-profiles";
import { showAnalysis } from "./show-analysis";
import { showTopicAnalysis } from "./show-topic-analysis";

export interface NlCopyBag {
  help: string;
  unknown: string;
  notConfigured: string;
  classifyFailed: string;
  quota: string;
  notMember: string;
  mutateDeferred: string;
  clarifySlug: string;
  clarifyTopic: string;
  noTopicAnalysis: string;
  noAnalysis: string;
  dataChannelOnly: string;
}

export interface HandleNaturalLanguageInput {
  chatId: number;
  threadId: number | null;
  callerTelegramUserId: number;
  classifiedText: string;
  dataTopicThreadId?: number | null; // filled after team resolve; optional hint
}

export interface HandleNaturalLanguageDeps {
  teamRepo: TeamRepo;
  memberRepo: MemberRepo;
  membershipRepo: MembershipRepo;
  profileRepo: ProfileRepo;
  hackathonAnalysisRepo: HackathonAnalysisRepo;
  repoTopicLinkRepo: RepoTopicLinkRepo;
  githubOrgClaimRepo: GithubOrgClaimRepo;
  nlClassifyQuota: NlClassifyQuota;
  intentClassifier: IntentClassifier;
  clock: Clock;
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
  | { kind: "reply"; text: string };

const EVENT = "nl-handle";

// PR2: classify + read intents. Mutate intents reply with deferred copy until PR3.
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

  return dispatchReadOrDeferred(classified, {
    teamId: team.id,
    actorMembershipId: membership.id,
    chatId: input.chatId,
    threadId: input.threadId,
    callerTelegramUserId: input.callerTelegramUserId,
    inDataChannel,
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
}

async function dispatchReadOrDeferred(
  classified: IntentResult,
  ctx: DispatchCtx,
  deps: HandleNaturalLanguageDeps,
): Promise<HandleNaturalLanguageResult> {
  const { intent, slots } = classified;

  if (intent === "help") return { kind: "reply", text: deps.copy.help };
  if (intent === "unknown") return { kind: "reply", text: deps.copy.unknown };

  if (NL_MUTATE_INTENTS.has(intent)) {
    return { kind: "reply", text: deps.copy.mutateDeferred };
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
