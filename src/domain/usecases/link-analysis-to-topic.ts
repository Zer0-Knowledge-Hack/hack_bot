import { AnalysisNotFoundError, NotFoundError, UnauthorizedError } from "../errors";
import { formatAnalysis } from "../hackathon/format";
import type { HackathonAnalysis } from "../entities";
import type { MembershipId, TeamId } from "../ids";
import type { ChatPublisher, HackathonAnalysisRepo, Logger, MembershipRepo } from "../ports";

export interface LinkAnalysisToTopicInput {
  teamId: TeamId;
  actorMembershipId: MembershipId;
  chatId: number;
  // Caller (adapter) has already refused a null thread, mirroring
  // link-repo-to-topic.ts's contract.
  threadId: number;
  slug: string;
}

export interface LinkAnalysisToTopicDeps {
  membershipRepo: MembershipRepo;
  hackathonAnalysisRepo: HackathonAnalysisRepo;
  chatPublisher: ChatPublisher;
  logger: Logger;
}

export interface LinkAnalysisToTopicResult {
  replyText: string;
}

// spec hackathon-analysis "One Analysis Per Topic, Conflicts Move the
// Link": only a team admin may link and pin (design.md "Ports" +
// link-repo-to-topic.ts's admin-gate pattern).
export async function linkAnalysisToTopic(
  input: LinkAnalysisToTopicInput,
  deps: LinkAnalysisToTopicDeps,
): Promise<LinkAnalysisToTopicResult> {
  const actor = await deps.membershipRepo.get(
    input.teamId,
    input.actorMembershipId,
  );
  if (!actor) {
    throw new NotFoundError("Actor membership not found");
  }
  if (actor.role !== "admin") {
    throw new UnauthorizedError("Only a team admin may link a hackathon");
  }

  const analysis = await deps.hackathonAnalysisRepo.findBySlug(
    input.teamId,
    input.slug,
  );
  if (!analysis) {
    throw new AnalysisNotFoundError("No analysis with that slug. See /hackathons.");
  }

  return postAnalysisAndLinkTopic(
    { teamId: input.teamId, chatId: input.chatId, threadId: input.threadId, analysis },
    deps,
  );
}

export interface PostAnalysisAndLinkTopicInput {
  teamId: TeamId;
  chatId: number;
  threadId: number;
  analysis: HackathonAnalysis;
}

export type PostAnalysisAndLinkTopicDeps = Pick<
  LinkAnalysisToTopicDeps,
  "hackathonAnalysisRepo" | "chatPublisher" | "logger"
>;

// The permission-free core (design.md "Pin Behavior": "a `/hackathon <url>`
// run inside a topic now links and pins from the consumer"). Reused by
// runHackathonJob's fresh-completion path (task 4.6), which has no acting
// membership to authorize — the producer already gated the fresh run on an
// admin (requestHackathonAnalysis).
export async function postAnalysisAndLinkTopic(
  input: PostAnalysisAndLinkTopicInput,
  deps: PostAnalysisAndLinkTopicDeps,
): Promise<LinkAnalysisToTopicResult> {
  const { teamId, chatId, threadId, analysis } = input;
  const notes: string[] = [];

  // spec: "Topic already holds a different analysis" — move the link,
  // unpinning whichever other analysis currently occupies this topic.
  const displaced = await deps.hackathonAnalysisRepo.findByThreadId(teamId, threadId);
  if (displaced && displaced.id !== analysis.id) {
    await safeUnpin(chatId, displaced.pinnedMessageId, deps);
    await deps.hackathonAnalysisRepo.save({
      ...displaced,
      threadId: null,
      pinnedMessageId: null,
    });
    notes.push(`Replaced the topic's previous link (was ${displaced.slug}).`);
  }

  // spec: "Analysis already linked to another topic" — unpin its old
  // message before relinking it here.
  const movedFromThreadId =
    analysis.threadId !== null && analysis.threadId !== threadId
      ? analysis.threadId
      : null;
  if (movedFromThreadId !== null) {
    await safeUnpin(chatId, analysis.pinnedMessageId, deps);
    notes.push(`Moved this analysis's link from another topic.`);
  }

  const text = formatAnalysis({
    slug: analysis.slug,
    fields: analysis.fields,
    suggestions: analysis.suggestedRepos,
  });
  const messageId = await deps.chatPublisher.post(chatId, threadId, text);

  let pinnedMessageId: number | null = messageId;
  try {
    await deps.chatPublisher.pin(chatId, messageId);
  } catch (err) {
    // Best-effort (spec "Pin Failure Falls Back to Unpinned Posting"): the
    // link still persists, but never silently — logged with a fixed
    // reason and only the error class name (FIXV-001 pattern).
    pinnedMessageId = null;
    deps.logger.log({
      event: "hackathon-link",
      teamId,
      outcome: "error",
      errorCode: err instanceof Error ? err.name : "UnknownError",
      reason: "pin-failed",
    });
    notes.push("Pinning failed; the message was posted unpinned.");
  }

  await deps.hackathonAnalysisRepo.save({ ...analysis, threadId, pinnedMessageId });

  const replyText = notes.length > 0 ? `${text}\n\n${notes.join("\n")}` : text;
  return { replyText };
}

// Best-effort (spec "Pin Behavior": unpins are best-effort too). Never
// crashes the caller, but stays observable via the logger.
async function safeUnpin(
  chatId: number,
  messageId: number | null,
  deps: Pick<PostAnalysisAndLinkTopicDeps, "chatPublisher" | "logger">,
): Promise<void> {
  if (messageId === null) return;
  try {
    await deps.chatPublisher.unpin(chatId, messageId);
  } catch (err) {
    deps.logger.log({
      event: "hackathon-link",
      outcome: "error",
      errorCode: err instanceof Error ? err.name : "UnknownError",
      reason: "unpin-failed",
    });
  }
}
