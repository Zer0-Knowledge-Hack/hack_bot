import type { TeamId, MembershipId } from "../../domain/ids";
import { participateInHackathon } from "../../domain/usecases/participate-in-hackathon";
import type { ParticipateInHackathonDeps } from "../../domain/usecases/participate-in-hackathon";
import { participateCopy } from "./copy";

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
