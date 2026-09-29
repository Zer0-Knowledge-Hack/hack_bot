import type { Bot } from "grammy";
import type { TeamId, MembershipId } from "../../domain/ids";
import type { MemberRepo, MembershipRepo, TeamRepo } from "../../domain/ports";
import { participateInHackathon } from "../../domain/usecases/participate-in-hackathon";
import type { ParticipateInHackathonDeps } from "../../domain/usecases/participate-in-hackathon";
import { PARTICIPATE_CALLBACK_PREFIX } from "./chat-publisher";
import { participateCopy } from "./copy";
import { callbackCallerLocation, resolveGroupMembership } from "./context";
import { isPrivateChat } from "./team-picker";

export interface ParticipationParams {
  event: string;
  teamId: TeamId;
  membershipId: MembershipId;
  chatId: number;
  slug: string;
  // The message that carried the tapped button, or null for the command.
  callbackMessageId: number | null;
  // Where a refusal goes (the command's reply, or a callback alert).
  reply: (text: string) => Promise<unknown>;
}

// Recognized refusals only (same convention as command-outcome.ts: keyed by
// the error's name; anything else is logged and rethrown to the single
// top-level boundary). A non-member is told the same as a non-admin.
function refusalReplies(slug: string): Record<string, string> {
  return {
    UnauthorizedError: participateCopy.adminOnly,
    NotFoundError: participateCopy.adminOnly,
    AnalysisNotFoundError: participateCopy.noAnalysis(slug),
    TopicRightsMissingError: participateCopy.noRights,
    ChatNotForumError: participateCopy.notForum,
    TopicCreationFailedError: participateCopy.createFailed,
    TopicCreationUncertainError: participateCopy.createUncertain,
  };
}

// design.md decision 8: a pre-creation refusal is a reply; everything the use
// case returns is delivered to General through a safe post (catch and log,
// never rethrow) so a failed reply cannot turn into a 500 and a redelivery.
export async function runParticipation(
  params: ParticipationParams,
  deps: ParticipateInHackathonDeps,
): Promise<void> {
  const { event, teamId } = params;
  let replyText: string | null;
  try {
    replyText = (
      await participateInHackathon(
        {
          teamId,
          actorMembershipId: params.membershipId,
          chatId: params.chatId,
          slug: params.slug,
          callbackMessageId: params.callbackMessageId,
        },
        deps,
      )
    ).replyText;
  } catch (err) {
    const errorCode = err instanceof Error ? err.name : "UnknownError";
    const refusal = refusalReplies(params.slug)[errorCode];
    if (refusal === undefined) {
      deps.logger.log({ event, teamId, outcome: "error", errorCode });
      throw err;
    }
    deps.logger.log({ event, teamId, outcome: "refused", errorCode });
    await params.reply(refusal);
    return;
  }

  deps.logger.log({ event, teamId, outcome: "ok" });
  if (replyText === null) return;
  try {
    await deps.chatPublisher.post(params.chatId, null, replyText);
  } catch (err) {
    deps.logger.log({
      event,
      teamId,
      outcome: "error",
      errorCode: err instanceof Error ? err.name : "UnknownError",
      reason: "general-post-failed",
    });
  }
}

// The button's callback data is untrusted: `hp:` plus a slug of at most 40
// characters (slug.ts MAX_SLUG_LENGTH). The team is never read from it.
const PARTICIPATE_DATA = new RegExp(
  `^${PARTICIPATE_CALLBACK_PREFIX}([a-z0-9]+(?:-[a-z0-9]+)*)$`,
);
const MAX_SLUG_LENGTH = 40;
const CALLBACK_EVENT = "hackathon-participate-callback";

export interface ParticipationCallbackDeps extends ParticipateInHackathonDeps {
  teamRepo: TeamRepo;
  memberRepo: MemberRepo;
  membershipRepo: MembershipRepo;
}

function errorCodeOf(err: unknown): string {
  return err instanceof Error ? err.name : "UnknownError";
}

// Registers the `hp:<slug>` handler. Malformed data or a foreign prefix never
// matches; a private or missing chat is ignored. A non-member or non-admin
// gets one alert and nothing changes. An admin's callback is answered early
// (creating a topic can be slow) and the rest is `runParticipation`. Only
// answerCallbackQuery and reply are best-effort: a Telegram failure on them
// must not become a 500 that redelivers the update.
export function registerParticipationCallback(bot: Bot, deps: ParticipationCallbackDeps): void {
  bot.callbackQuery(PARTICIPATE_DATA, async (ctx) => {
    const slug = PARTICIPATE_DATA.exec(ctx.callbackQuery.data)?.[1];
    const loc = callbackCallerLocation(ctx);
    if (slug === undefined || slug.length > MAX_SLUG_LENGTH || !loc || isPrivateChat(ctx)) return;

    const safe = async (action: () => Promise<unknown>, reason: string): Promise<void> => {
      try {
        await action();
      } catch (err) {
        deps.logger.log({ event: CALLBACK_EVENT, outcome: "error", errorCode: errorCodeOf(err), reason });
      }
    };

    const resolved = await resolveGroupMembership(deps, loc.chatId, loc.userId);
    if (!resolved || resolved.membership.role !== "admin") {
      deps.logger.log({
        event: CALLBACK_EVENT,
        outcome: "refused",
        errorCode: resolved ? "UnauthorizedError" : "NotFoundError",
      });
      await safe(
        () => ctx.answerCallbackQuery({ text: participateCopy.adminOnly, show_alert: true }),
        "answer-failed",
      );
      return;
    }

    await safe(() => ctx.answerCallbackQuery(), "answer-failed");
    await runParticipation(
      {
        event: CALLBACK_EVENT,
        teamId: resolved.team.id,
        membershipId: resolved.membership.id,
        chatId: loc.chatId,
        slug,
        callbackMessageId: loc.messageId,
        reply: (text) => safe(() => ctx.reply(text), "reply-failed"),
      },
      deps,
    );
  });
}
