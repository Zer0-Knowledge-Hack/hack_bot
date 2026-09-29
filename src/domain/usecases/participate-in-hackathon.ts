import { participationCopy } from "../copy";
import {
  AnalysisNotFoundError,
  ChatNotForumError,
  ForumTopicCreateError,
  PublishFailedError,
  TopicCreationFailedError,
  TopicCreationUncertainError,
  TopicRightsMissingError,
  UnauthorizedError,
} from "../errors";
import { TOPIC_ICON_EMOJI, sanitizeTopicName, topicLink, topicNameFor } from "../hackathon/topic";
import type { HackathonAnalysis } from "../entities";
import type { MembershipId, TeamId } from "../ids";
import type {
  ChatPublisher,
  Clock,
  ForumTopicManager,
  HackathonAnalysisRepo,
  Logger,
  MembershipRepo,
} from "../ports";
import { postAnalysisAndLinkTopic } from "./link-analysis-to-topic";

// design.md decision 3: the creation claim outlives a slow createForumTopic
// but not a stuck one.
const CLAIM_TTL_MS = 60_000;

export interface ParticipateInHackathonInput {
  teamId: TeamId;
  actorMembershipId: MembershipId;
  chatId: number;
  slug: string;
  // The message carrying the tapped button (callback trigger), or null for
  // `/hackathon join`.
  callbackMessageId: number | null;
}

export interface ParticipateInHackathonDeps {
  membershipRepo: MembershipRepo;
  hackathonAnalysisRepo: HackathonAnalysisRepo;
  chatPublisher: ChatPublisher;
  forumTopicManager: ForumTopicManager;
  clock: Clock;
  logger: Logger;
}

// `replyText` is what the adapter posts to General; null means a neutral
// no-op (a concurrent tap holds the claim, nothing to say).
export type ParticipateInHackathonResult =
  | { kind: "created" | "already" | "postFailed" | "linkFailed"; replyText: string }
  | { kind: "busy"; replyText: null };

// hackathon-participation design.md "Use Case Step Order". Everything up to
// and including `create` may throw a domain error (nothing exists yet, or
// the claim decides). From `moveTopicLink` on the topic exists, so this
// function NEVER throws again: a redelivery would create a second topic.
export async function participateInHackathon(
  input: ParticipateInHackathonInput,
  deps: ParticipateInHackathonDeps,
): Promise<ParticipateInHackathonResult> {
  const { teamId, chatId, slug } = input;

  // 1. Admin gate, then the slug lookup.
  const actor = await deps.membershipRepo.get(teamId, input.actorMembershipId);
  if (!actor || actor.role !== "admin") {
    throw new UnauthorizedError("Only a team admin may confirm participation");
  }
  const analysis = await deps.hackathonAnalysisRepo.findBySlug(teamId, slug);
  if (!analysis) {
    throw new AnalysisNotFoundError("No analysis with that slug");
  }

  // 2. Verify an existing topic by doing the real action: post the analysis
  // into it. Telegram accepts a chat action for a deleted thread, so only a
  // thread-gone post proves the topic is gone. Success and any ambiguous failure
  // both mean "keep it": never recreate on ambiguity.
  let expected: number | null = null;
  if (analysis.threadId !== null) {
    if (!(await topicIsGone(input, analysis, analysis.threadId, deps))) {
      await clearButtons(input, analysis, deps);
      return {
        kind: "already",
        replyText: participationCopy.alreadyHasTopic(topicLink(chatId, analysis.threadId)),
      };
    }
    expected = analysis.threadId;
  }

  // 3. CAS claim. A lost claim re-reads: a link that differs from what we
  // observed means the winner already finished.
  const won = await deps.hackathonAnalysisRepo.claimTopicCreation(
    teamId,
    analysis.id,
    expected,
    deps.clock.now(),
    CLAIM_TTL_MS,
  );
  if (!won) {
    const current = await deps.hackathonAnalysisRepo.findBySlug(teamId, slug);
    if (current && current.threadId !== null && current.threadId !== expected) {
      return {
        kind: "already",
        replyText: participationCopy.alreadyHasTopic(topicLink(chatId, current.threadId)),
      };
    }
    return { kind: "busy", replyText: null };
  }

  // 4. Create. Only a known-not-created failure releases the claim.
  const name = analysis.fields.name?.value;
  let threadId: number;
  try {
    threadId = await deps.forumTopicManager.create(
      chatId,
      topicNameFor(name, analysis.slug, true),
      { iconEmoji: TOPIC_ICON_EMOJI, fallbackName: topicNameFor(name, analysis.slug, false) },
    );
  } catch (err) {
    if (err instanceof ForumTopicCreateError) {
      if (err.failure === "unavailable") {
        throw new TopicCreationUncertainError("Topic creation outcome is uncertain");
      }
      await releaseClaim(analysis, deps);
      throw refusalFor(err.failure);
    }
    // Unknown failure: the topic may exist, so the claim stays until its TTL.
    throw err;
  }

  // 5. No-throw zone. Link immediately, before anything else can fail.
  const link = topicLink(chatId, threadId);
  try {
    await deps.hackathonAnalysisRepo.moveTopicLink(teamId, analysis.id, threadId, null);
  } catch (err) {
    logFailure(deps, teamId, "link-failed", err);
    return { kind: "linkFailed", replyText: participationCopy.linkFailed(analysis.slug, link) };
  }

  // 6. Post and pin in the new topic; the threadId override avoids a spurious
  // unpin and "moved" note for a recreated topic.
  let notes: string[];
  try {
    const posted = await postAnalysisAndLinkTopic(
      { teamId, chatId, threadId, analysis: { ...analysis, threadId } },
      deps,
    );
    notes = posted.notes;
  } catch (err) {
    logFailure(deps, teamId, "post-failed", err);
    return { kind: "postFailed", replyText: participationCopy.postFailed(analysis.slug, link) };
  }

  // 7. Remove the button(s), best-effort, and confirm.
  await clearButtons(input, analysis, deps);
  const confirmed = participationCopy.confirmed(sanitizeTopicName(name, analysis.slug), link);
  return { kind: "created", replyText: [confirmed, ...notes].join("\n") };
}

// Posts (and pins) the analysis in the linked topic. Only `thread-gone` (the
// adapter saw a 400 saying the thread does not exist) is a positive deleted
// signal. `rejected` (closed topic, no rights, any other 4xx), unavailable,
// rate-limited and any other failure leave the topic as unknown: a live topic
// can produce them, and recreating would duplicate it.
async function topicIsGone(
  input: ParticipateInHackathonInput,
  analysis: HackathonAnalysis,
  threadId: number,
  deps: ParticipateInHackathonDeps,
): Promise<boolean> {
  try {
    await postAnalysisAndLinkTopic(
      { teamId: input.teamId, chatId: input.chatId, threadId, analysis },
      deps,
    );
    return false;
  } catch (err) {
    if (err instanceof PublishFailedError && err.failureClass === "thread-gone") return true;
    logFailure(deps, input.teamId, "topic-check-failed", err);
    return false;
  }
}

function refusalFor(failure: ForumTopicCreateError["failure"]): Error {
  switch (failure) {
    case "no-rights":
      return new TopicRightsMissingError("Bot cannot manage topics");
    case "not-forum":
      return new ChatNotForumError("Chat is not a forum");
    default:
      return new TopicCreationFailedError("Telegram refused the topic creation");
  }
}

async function releaseClaim(
  analysis: HackathonAnalysis,
  deps: ParticipateInHackathonDeps,
): Promise<void> {
  try {
    await deps.hackathonAnalysisRepo.releaseTopicClaim(analysis.teamId, analysis.id);
  } catch (err) {
    // The claim just expires on its TTL; the caller still gets its refusal.
    logFailure(deps, analysis.teamId, "claim-release-failed", err);
  }
}

// The deduped set {callback message, stored General message}; every removal
// is best-effort (a message may be gone or unknown).
async function clearButtons(
  input: ParticipateInHackathonInput,
  analysis: HackathonAnalysis,
  deps: ParticipateInHackathonDeps,
): Promise<void> {
  const ids = new Set<number>();
  if (input.callbackMessageId !== null) ids.add(input.callbackMessageId);
  if (analysis.generalMessageId !== null) ids.add(analysis.generalMessageId);
  for (const messageId of ids) {
    try {
      await deps.chatPublisher.clearButtons(input.chatId, messageId);
    } catch (err) {
      logFailure(deps, input.teamId, "clear-buttons-failed", err);
    }
  }
}

function logFailure(
  deps: Pick<ParticipateInHackathonDeps, "logger">,
  teamId: TeamId,
  reason: string,
  err: unknown,
): void {
  deps.logger.log({
    event: "hackathon-participate",
    teamId,
    outcome: "error",
    errorCode: err instanceof Error ? err.name : "UnknownError",
    reason,
  });
}
