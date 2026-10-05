import type { Bot, Context, NextFunction } from "grammy";
import type { Membership, ProfileField, RepoTopicLink } from "../../domain/entities";
import type { MembershipId, TeamId } from "../../domain/ids";
import { isEligibleNlMessage } from "../../domain/nl/eligibility";
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
} from "../../domain/ports";
import { handleNaturalLanguage } from "../../domain/usecases/handle-natural-language";
import { ROLE_LABELS, commonCopy, nlCopy, profileCopy, repoCopy } from "./copy";
import { joinLinesWithinLimit } from "../../domain/text-limit";
import { isPrivateChat } from "./team-picker";

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
  nlClassifyQuota: NlClassifyQuota;
  intentClassifier: IntentClassifier;
  clock: Clock;
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

// Eligible group mention / reply-to-bot → IntentClassifier → reads (PR2).
// Must be registered after slash-command handlers so commands win first.
export function registerNaturalLanguage(bot: Bot, deps: NaturalLanguageDeps): void {
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
    const replyFromId = ctx.message?.reply_to_message?.from?.id;
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

    try {
      const result = await handleNaturalLanguage(
        {
          chatId: loc.id,
          threadId: ctx.message?.message_thread_id ?? null,
          callerTelegramUserId: from.id,
          classifiedText: eligibility.classifiedText,
        },
        {
          ...deps,
          copy: {
            help: nlCopy.help,
            unknown: nlCopy.unknown,
            notConfigured: nlCopy.notConfigured,
            classifyFailed: nlCopy.classifyFailed,
            quota: nlCopy.quota,
            notMember: commonCopy.notMember,
            mutateDeferred: nlCopy.mutateDeferred,
            clarifySlug: nlCopy.clarifySlug,
            clarifyTopic: nlCopy.clarifyTopic,
            noTopicAnalysis: nlCopy.noTopicAnalysis,
            noAnalysis: nlCopy.noAnalysis,
            dataChannelOnly: nlCopy.dataChannelOnly,
          },
          formatRepoLinks,
          formatProfiles,
        },
      );
      if (result.kind === "ignore") {
        await next();
        return;
      }
      await ctx.reply(result.text);
    } catch (err) {
      deps.logger.log({
        event: EVENT,
        outcome: "error",
        errorCode: errorCodeOf(err),
        reason: "nl-handler-failed",
      });
    }
  });
}
