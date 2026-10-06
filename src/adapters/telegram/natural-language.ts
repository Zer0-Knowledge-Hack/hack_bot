import type { Bot, Context, NextFunction } from "grammy";
import type { Membership, ProfileField, RepoTopicLink } from "../../domain/entities";
import type { MembershipId, TeamId } from "../../domain/ids";
import { isEligibleNlMessage } from "../../domain/nl/eligibility";
import { joinLinesWithinLimit } from "../../domain/text-limit";
import type {
  AnalysisJobQueue,
  AnalysisJobRepo,
  AnalysisQuota,
  ChatAdminChecker,
  ChatPublisher,
  Clock,
  ForumTopicManager,
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
  Sleep,
  TeamRepo,
} from "../../domain/ports";
import { handleNaturalLanguage } from "../../domain/usecases/handle-natural-language";
import {
  resolveNlConfirmation,
  resolveNlPick,
} from "../../domain/usecases/resolve-nl-confirmation";
import {
  ROLE_LABELS,
  commonCopy,
  hackathonCopy,
  joinCopy,
  nlConfirmCopy,
  nlCopy,
  participateCopy,
  profileCopy,
  repoCopy,
  roleCopy,
  setupCopy,
} from "./copy";
import {
  NL_CONFIRM_NO_PREFIX,
  NL_CONFIRM_OK_PREFIX,
  NL_PICK_PREFIX,
} from "./chat-publisher";
import { isPrivateChat } from "./team-picker";
import { callbackCallerLocation } from "./context";

const EVENT = "nl-text";
const REPLY_MAX = 4096;

export interface NaturalLanguageDeps {
  teamRepo: TeamRepo;
  memberRepo: MemberRepo;
  membershipRepo: MembershipRepo;
  profileRepo: ProfileRepo;
  hackathonAnalysisRepo: HackathonAnalysisRepo;
  repoTopicLinkRepo: RepoTopicLinkRepo;
  githubOrgClaimRepo: GithubOrgClaimRepo;
  analysisQuota: AnalysisQuota;
  analysisJobRepo: AnalysisJobRepo;
  analysisJobQueue: AnalysisJobQueue;
  chatAdminChecker: ChatAdminChecker;
  chatPublisher: ChatPublisher;
  forumTopicManager: ForumTopicManager;
  nlClassifyQuota: NlClassifyQuota;
  nlConfirmationRepo: NlConfirmationRepo;
  intentClassifier: IntentClassifier;
  sleep: Sleep;
  clock: Clock;
  idGen: IdGen;
  logger: Logger;
  nlModelPrimary: string;
}

function errorCodeOf(err: unknown): string {
  return err instanceof Error ? err.name : "UnknownError";
}

function isBotCommandMessage(ctx: Context): boolean {
  const entities = ctx.message?.entities;
  if (!entities) return false;
  return entities.some((e) => e.type === "bot_command");
}

function chatTypeOf(ctx: Context): "private" | "group" | "supergroup" | "channel" | null {
  const type = ctx.chat?.type;
  if (type === "private" || type === "group" || type === "supergroup" || type === "channel") {
    return type;
  }
  return null;
}

function formatRepoLinks(links: RepoTopicLink[]): string {
  const lines = links.map((l) => repoCopy.line(l.repoFullName, l.threadId));
  return joinLinesWithinLimit(lines, REPLY_MAX, repoCopy.none);
}

function formatFieldLine(field: ProfileField): string {
  return `${field.field}: ${field.unreadable ? profileCopy.unreadable : field.value}`;
}

function memberIdentity(membershipId: MembershipId, ownFields: ProfileField[]): string {
  const fullName = ownFields.find((f) => f.field === "full_name");
  const github = ownFields.find((f) => f.field === "github_username");
  const parts: string[] = [];
  if (fullName) parts.push(fullName.unreadable ? profileCopy.unreadable : fullName.value);
  if (github) parts.push(github.unreadable ? profileCopy.unreadable : `@${github.value}`);
  return parts.length ? ` (${parts.join(", ")})` : "";
}

function formatMemberBlock(membership: Membership, fields: ProfileField[]): string {
  const own = fields.filter((f) => f.membershipId === membership.id);
  const header = profileCopy.memberHeader(
    membership.id,
    memberIdentity(membership.id, own),
    ROLE_LABELS[membership.role],
  );
  const lines = own.map(formatFieldLine);
  return [header, ...(lines.length ? lines : [profileCopy.noFields])].join("\n");
}

function formatProfiles(
  memberships: Membership[],
  fields: ProfileField[],
  teamId: TeamId,
): string {
  if (memberships.length === 0) {
    return `${profileCopy.teamHeader(teamId)}\n${profileCopy.noMatch}`;
  }
  return `${profileCopy.teamHeader(teamId)}\n${memberships.map((m) => formatMemberBlock(m, fields)).join("\n\n")}`;
}

function nlCopyBag() {
  return {
    help: nlCopy.help,
    unknown: nlCopy.unknown,
    notConfigured: nlCopy.notConfigured,
    classifyFailed: nlCopy.classifyFailed,
    quota: nlCopy.quota,
    notMember: commonCopy.notMember,
    clarifySlug: nlCopy.clarifySlug,
    clarifyTopic: nlCopy.clarifyTopic,
    noTopicAnalysis: nlCopy.noTopicAnalysis,
    noAnalysis: nlCopy.noAnalysis,
    hackathonNotLinked: nlCopy.hackathonNotLinked,
    unlinkWrongTopic: nlCopy.unlinkWrongTopic,
    unlinkWrongTopicMany: nlCopy.unlinkWrongTopicMany,
    pickUnlink: nlCopy.pickUnlink,
    noLinkedMatch: nlCopy.noLinkedMatch,
    dataChannelOnly: profileCopy.dataChannelOnly,
    profileDataChannelOnly: nlConfirmCopy.profileDataChannelOnly,
    clarifyMembership: nlConfirmCopy.clarifyMembership,
    clarifyRepo: nlConfirmCopy.clarifyRepo,
    clarifyUrl: nlConfirmCopy.clarifyUrl,
    clarifyThread: nlConfirmCopy.clarifyThread,
    lexiconHint: nlConfirmCopy.lexiconHint,
    confirmPrompt: nlConfirmCopy.confirmPrompt,
    confirmSummaries: nlConfirmCopy.summaries,
    resolveCopy: {
      cancelled: nlConfirmCopy.cancelled,
      busy: nlConfirmCopy.busy,
      wrongActor: nlConfirmCopy.wrongActor,
      notMember: commonCopy.notMember,
      executeFailed: nlConfirmCopy.executeFailed,
      errorReplies: {
        UnauthorizedError: roleCopy.adminOnly,
        NotFoundError: commonCopy.notMember,
        AlreadyExistsError: joinCopy.alreadyMember,
        LastAdminError: roleCopy.lastAdmin,
        ChatAdminCheckFailedError: setupCopy.adminCheckFailed,
        AnalysisNotFoundError: hackathonCopy.noAnalysis,
        UnsafeUrlError: hackathonCopy.unsafeUrl,
        OrgNotClaimedError: repoCopy.orgNotClaimed,
        DailyCapReachedError: hackathonCopy.dailyCap,
        AnalysisBusyError: hackathonCopy.busy,
        QueueSendFailedError: hackathonCopy.queueSendFailed,
        ConfigError: hackathonCopy.notConfigured,
        TopicRightsMissingError: participateCopy.noRights,
        ChatNotForumError: participateCopy.notForum,
        TopicCreationFailedError: participateCopy.createFailed,
        TopicCreationUncertainError: participateCopy.createUncertain,
      },
    },
  };
}

const NL_OK = new RegExp(`^${NL_CONFIRM_OK_PREFIX}([0-9a-fA-F-]{8,64})$`);
const NL_NO = new RegExp(`^${NL_CONFIRM_NO_PREFIX}([0-9a-fA-F-]{8,64})$`);
const NL_PICK = new RegExp(`^${NL_PICK_PREFIX}([0-9a-fA-F-]{8,64}):(\\d+)$`);

export function registerNlConfirmCallbacks(bot: Bot, deps: NaturalLanguageDeps): void {
  bot.callbackQuery(NL_OK, async (ctx) => {
    await handleNlCallback(ctx, deps, "yes");
  });
  bot.callbackQuery(NL_NO, async (ctx) => {
    await handleNlCallback(ctx, deps, "cancel");
  });
  bot.callbackQuery(NL_PICK, async (ctx) => {
    await handleNlPickCallback(ctx, deps);
  });
}

async function handleNlPickCallback(ctx: Context, deps: NaturalLanguageDeps): Promise<void> {
  const data = ctx.callbackQuery?.data ?? "";
  const match = NL_PICK.exec(data);
  const confirmationId = match?.[1];
  const pickIndex = match?.[2] !== undefined ? Number(match[2]) : NaN;
  const loc = callbackCallerLocation(ctx);
  try {
    await ctx.answerCallbackQuery();
  } catch {
    /* best-effort */
  }
  if (!confirmationId || !loc || !Number.isFinite(pickIndex)) return;

  try {
    const copy = nlCopyBag();
    const result = await resolveNlPick(
      {
        chatId: loc.chatId,
        callerTelegramUserId: loc.userId,
        confirmationId,
        pickIndex,
        callbackMessageId: ctx.callbackQuery?.message?.message_id ?? null,
      },
      {
        ...deps,
        copy: copy.resolveCopy,
        confirmPrompt: copy.confirmPrompt,
        confirmSummaries: copy.confirmSummaries,
      },
    );
    if (result.kind === "reply") {
      await ctx.reply(result.text);
    }
  } catch (err) {
    deps.logger.log({
      event: "nl-pick-callback",
      outcome: "error",
      errorCode: errorCodeOf(err),
    });
    try {
      await ctx.reply(nlConfirmCopy.executeFailed);
    } catch {
      /* ignore */
    }
  }
}

async function handleNlCallback(
  ctx: Context,
  deps: NaturalLanguageDeps,
  action: "yes" | "cancel",
): Promise<void> {
  const data = ctx.callbackQuery?.data ?? "";
  const match = action === "yes" ? NL_OK.exec(data) : NL_NO.exec(data);
  const confirmationId = match?.[1];
  const loc = callbackCallerLocation(ctx);
  if (!confirmationId || !loc) {
    try {
      await ctx.answerCallbackQuery();
    } catch {
      /* ignore */
    }
    return;
  }

  try {
    await ctx.answerCallbackQuery();
  } catch {
    /* best-effort */
  }

  try {
    const result = await resolveNlConfirmation(
      {
        chatId: loc.chatId,
        callerTelegramUserId: loc.userId,
        confirmationId,
        action,
        callbackMessageId: ctx.callbackQuery?.message?.message_id ?? null,
      },
      { ...deps, copy: nlCopyBag().resolveCopy },
    );
    if (result.kind === "reply") {
      await ctx.reply(result.text);
    }
  } catch (err) {
    deps.logger.log({
      event: "nl-confirm-callback",
      outcome: "error",
      errorCode: errorCodeOf(err),
    });
    try {
      await ctx.reply(nlConfirmCopy.executeFailed);
    } catch {
      /* ignore */
    }
  }
}

export function registerNaturalLanguage(bot: Bot, deps: NaturalLanguageDeps): void {
  registerNlConfirmCallbacks(bot, deps);

  bot.on("message:text", async (ctx, next: NextFunction) => {
    if (isPrivateChat(ctx)) {
      await next();
      return;
    }

    const chatType = chatTypeOf(ctx);
    const botUsername = bot.botInfo.username;
    if (chatType === null || !botUsername) {
      await next();
      return;
    }

    const botId = bot.botInfo.id;
    const replyFrom = ctx.message?.reply_to_message?.from;
    const replyFromId = replyFrom?.id;
    const eligibility = isEligibleNlMessage({
      chatType,
      text: ctx.message?.text,
      botUsername,
      botId,
      isCommand: isBotCommandMessage(ctx),
      replyFromBotId: replyFromId === botId ? botId : null,
    });
    if (!eligibility.eligible) {
      await next();
      return;
    }

    const loc = ctx.chat;
    const from = ctx.from;
    if (!loc || !from) {
      await next();
      return;
    }

    const replyToMessageId = ctx.message?.reply_to_message?.message_id ?? null;
    const replyFromUserId =
      replyFrom && !replyFrom.is_bot ? replyFrom.id : null;

    try {
      const result = await handleNaturalLanguage(
        {
          chatId: loc.id,
          threadId: ctx.message?.message_thread_id ?? null,
          callerTelegramUserId: from.id,
          classifiedText: eligibility.classifiedText,
          replyToMessageId,
          replyFromUserId,
        },
        {
          ...deps,
          copy: nlCopyBag(),
          formatRepoLinks,
          formatProfiles,
        },
      );
      if (result.kind === "ignore") {
        await next();
        return;
      }
      if (result.kind === "done") return;
      await ctx.reply(result.text);
    } catch (err) {
      deps.logger.log({
        event: EVENT,
        outcome: "error",
        errorCode: errorCodeOf(err),
        reason: "nl-handler-failed",
      });
      try {
        await ctx.reply(nlConfirmCopy.executeFailed);
      } catch {
        /* ignore */
      }
    }
  });
}
