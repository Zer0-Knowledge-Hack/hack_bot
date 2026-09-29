import type { Bot, Context } from "grammy";
import { NotFoundError, UnsafeUrlError } from "../../domain/errors";
import { classifyHackathonArgument, parseJoinArgument } from "../../domain/hackathon/argument";
import { assertSafeUrl } from "../../domain/hackathon/url";
import type {
  AnalysisJobQueue,
  AnalysisJobRepo,
  AnalysisQuota,
  ChatPublisher,
  Clock,
  ForumTopicManager,
  HackathonAnalysisRepo,
  IdGen,
  Logger,
  MemberRepo,
  MembershipRepo,
  Sleep,
  TeamRepo,
} from "../../domain/ports";
import { linkAnalysisToTopic } from "../../domain/usecases/link-analysis-to-topic";
import { listAnalyses } from "../../domain/usecases/list-analyses";
import { requestHackathonAnalysis } from "../../domain/usecases/request-hackathon-analysis";
import { showAnalysis } from "../../domain/usecases/show-analysis";
import { showTopicAnalysis } from "../../domain/usecases/show-topic-analysis";
import { commonCopy, hackathonCopy, participateCopy } from "./copy";
import { runCommand } from "./command-outcome";
import type { DomainErrorReasons, DomainErrorReplies } from "./command-outcome";
import { callerLocation, resolveGroupMembership } from "./context";
import type { CallerLocation } from "./context";
import { registerParticipationCallback, runParticipation } from "./participation";
import { isPrivateChat } from "./team-picker";

// `/hackathon` and `/hackathons` (design.md "Data Flow", "Error Taxonomy" —
// producer rows). Like every command in commands.ts, grammY stays an edge
// adapter: read the caller's location, call exactly one use case through
// `runCommand`, map the result or the recognized domain errors to a plain
// text reply. Both commands are scoped to the team's group: a fresh run
// posts its result back into that chat or topic, and linking needs a topic.
export interface HackathonCommandDeps {
  teamRepo: TeamRepo;
  memberRepo: MemberRepo;
  membershipRepo: MembershipRepo;
  hackathonAnalysisRepo: HackathonAnalysisRepo;
  analysisQuota: AnalysisQuota;
  analysisJobQueue: AnalysisJobQueue;
  analysisJobRepo: AnalysisJobRepo;
  chatPublisher: ChatPublisher;
  forumTopicManager: ForumTopicManager;
  sleep: Sleep;
  clock: Clock;
  idGen: IdGen;
  logger: Logger;
}

// hackathon_analysis_jobs.fetch_url is CHECK-limited to 2048 characters
// (migrations/0003_hackathon_analysis.sql).
const FETCH_URL_MAX = 2048;

// An adapter-level refusal (no domain rule is involved): the URL would not
// fit the job row. Keyed by name in ERROR_REPLIES like every domain error.
class UrlTooLongError extends Error {
  override name = "UrlTooLongError";
}

// Every domain error the hackathon use cases can throw MUST be listed here
// (or deliberately left unrecognized, which rethrows to a 500) — see
// command-outcome.ts. Texts are the design.md "Error Taxonomy" replies.
const ERROR_REPLIES: DomainErrorReplies = {
  NotFoundError: commonCopy.notMember,
  UnauthorizedError: hackathonCopy.adminOnly,
  AnalysisNotFoundError: hackathonCopy.noAnalysis,
  UnsafeUrlError: hackathonCopy.unsafeUrl,
  UrlTooLongError: hackathonCopy.urlTooLong(FETCH_URL_MAX),
  DailyCapReachedError: hackathonCopy.dailyCap,
  AnalysisBusyError: hackathonCopy.busy,
  QueueSendFailedError: hackathonCopy.queueSendFailed,
  ConfigError: hackathonCopy.notConfigured,
  PublishFailedError: hackathonCopy.publishFailed,
};

// Fixed, non-sensitive log reasons (design.md "Error Taxonomy" — Log reason).
const ERROR_REASONS: DomainErrorReasons = {
  UnsafeUrlError: (err) => `unsafe-url:${(err as UnsafeUrlError).reason}`,
  QueueSendFailedError: "queue:send-failed",
};

async function requireGroupCaller(
  ctx: Context,
  deps: HackathonCommandDeps,
  event: string,
): Promise<CallerLocation | null> {
  const loc = callerLocation(ctx);
  if (!loc) return null;
  if (isPrivateChat(ctx)) {
    deps.logger.log({ event, outcome: "refused", errorCode: "PrivateChat" });
    await ctx.reply(hackathonCopy.groupOnly);
    return null;
  }
  return loc;
}

async function resolveMember(deps: HackathonCommandDeps, loc: CallerLocation) {
  const resolved = await resolveGroupMembership(deps, loc.chatId, loc.userId);
  if (!resolved) throw new NotFoundError("Caller is not a member of this team");
  return resolved;
}

export function registerHackathonCommands(bot: Bot, deps: HackathonCommandDeps): void {
  registerParticipationCallback(bot, deps);
  bot.command("hackathon", async (ctx) => {
    const loc = await requireGroupCaller(ctx, deps, "hackathon");
    if (!loc) return;
    const argument = ctx.match.trim();

    if (argument === "") {
      await showLinkedAnalysis(ctx, loc, deps);
      return;
    }
    // `join` is checked before the whitespace rule (design.md decision 6).
    const join = parseJoinArgument(argument);
    if (join?.kind === "join-usage") {
      deps.logger.log({ event: "hackathon-join", outcome: "refused", errorCode: "BadArgument" });
      await ctx.reply(participateCopy.joinUsage);
      return;
    }
    if (join) {
      await joinHackathon(ctx, loc, join.slug, deps);
      return;
    }
    if (/\s/.test(argument)) {
      deps.logger.log({ event: "hackathon", outcome: "refused", errorCode: "BadArgument" });
      await ctx.reply(hackathonCopy.usage);
      return;
    }
    const classified = classifyHackathonArgument(argument);
    if (classified.kind === "slug") {
      await showBySlug(ctx, loc, classified.value, deps);
      return;
    }
    await requestFresh(ctx, loc, classified.value, deps);
  });

  bot.command("hackathons", async (ctx) => {
    const loc = await requireGroupCaller(ctx, deps, "list-hackathons");
    if (!loc) return;
    await runCommand(
      {
        event: "list-hackathons",
        logger: deps.logger,
        reply: (text) => ctx.reply(text),
        errorReplies: ERROR_REPLIES,
      },
      async () => {
        const { team, membership } = await resolveMember(deps, loc);
        const result = await listAnalyses(
          { teamId: team.id, actorMembershipId: membership.id },
          deps,
        );
        return { okReply: result.replyText, teamId: team.id };
      },
    );
  });
}

// spec "No-Argument Behavior Depends on Topic Linking": the linked topic's
// analysis, or usage when there is nothing to show (general chat included).
async function showLinkedAnalysis(
  ctx: Context,
  loc: CallerLocation,
  deps: HackathonCommandDeps,
): Promise<void> {
  await runCommand(
    {
      event: "hackathon-topic-show",
      logger: deps.logger,
      reply: (text) => ctx.reply(text),
      errorReplies: ERROR_REPLIES,
    },
    async () => {
      const { team, membership } = await resolveMember(deps, loc);
      if (loc.threadId === null) return { okReply: hackathonCopy.usage, teamId: team.id };
      const result = await showTopicAnalysis(
        { teamId: team.id, actorMembershipId: membership.id, threadId: loc.threadId },
        deps,
      );
      return { okReply: result?.replyText ?? hackathonCopy.usage, teamId: team.id };
    },
  );
}

// spec "Any Member Re-Shows by Slug, Free of Cap": a plain re-show for any
// member; when a team admin runs it inside a topic, the analysis is also
// linked and pinned there (spec "One Analysis Per Topic, Conflicts Move the
// Link"). The link posts the analysis itself (pinned), so the acknowledgement
// only carries the link outcome — never the analysis a second time.
async function showBySlug(
  ctx: Context,
  loc: CallerLocation,
  slug: string,
  deps: HackathonCommandDeps,
): Promise<void> {
  await runCommand(
    {
      event: "hackathon-show",
      logger: deps.logger,
      reply: (text) => ctx.reply(text),
      errorReplies: ERROR_REPLIES,
    },
    async () => {
      const { team, membership } = await resolveMember(deps, loc);
      if (loc.threadId !== null && membership.role === "admin") {
        const linked = await linkAnalysisToTopic(
          {
            teamId: team.id,
            actorMembershipId: membership.id,
            chatId: loc.chatId,
            threadId: loc.threadId,
            slug,
          },
          deps,
        );
        return {
          okReply:
            linked.notes.length > 0 ? linked.notes.join("\n") : commonCopy.linkedHere(slug),
          teamId: team.id,
        };
      }
      const shown = await showAnalysis(
        { teamId: team.id, actorMembershipId: membership.id, slug },
        deps,
      );
      return { okReply: shown.replyText, teamId: team.id };
    },
  );
}

// spec "Admin-Only Fresh Analysis, Capped": guard the URL string, then reserve
// the slot, enqueue and acknowledge (the page fetch and LLM run on the queue
// consumer). Nothing here logs the URL — only fixed codes.
async function requestFresh(
  ctx: Context,
  loc: CallerLocation,
  rawUrl: string,
  deps: HackathonCommandDeps,
): Promise<void> {
  await runCommand(
    {
      event: "hackathon-request",
      logger: deps.logger,
      reply: (text) => ctx.reply(text),
      errorReplies: ERROR_REPLIES,
      errorReasons: ERROR_REASONS,
    },
    async () => {
      const guard = assertSafeUrl(rawUrl);
      if (!guard.ok) throw new UnsafeUrlError("URL failed the safety guard", guard.reason);
      const { team, membership } = await resolveMember(deps, loc);
      if (guard.url.href.length > FETCH_URL_MAX) throw new UrlTooLongError();
      const result = await requestHackathonAnalysis(
        {
          teamId: team.id,
          actorMembershipId: membership.id,
          chatId: loc.chatId,
          threadId: loc.threadId,
          sourceUrl: guard.url.href,
        },
        deps,
      );
      return { okReply: result.replyText, teamId: team.id };
    },
  );
}

// `/hackathon join <slug>`: the same behavior as the participation button,
// from General or any topic. The team comes from the chat and the role from
// the caller; a non-member gets the same refusal as a non-admin.
async function joinHackathon(
  ctx: Context,
  loc: CallerLocation,
  slug: string,
  deps: HackathonCommandDeps,
): Promise<void> {
  const resolved = await resolveGroupMembership(deps, loc.chatId, loc.userId);
  if (!resolved) {
    deps.logger.log({ event: "hackathon-join", outcome: "refused", errorCode: "NotFoundError" });
    await ctx.reply(participateCopy.adminOnly);
    return;
  }
  await runParticipation(
    {
      event: "hackathon-join",
      teamId: resolved.team.id,
      membershipId: resolved.membership.id,
      chatId: loc.chatId,
      slug,
      callbackMessageId: null,
      reply: (text) => ctx.reply(text),
    },
    deps,
  );
}
