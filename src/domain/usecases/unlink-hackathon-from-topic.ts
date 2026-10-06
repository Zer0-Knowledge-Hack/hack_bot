import { AnalysisNotFoundError, NotFoundError, UnauthorizedError } from "../errors";
import type { HackathonAnalysis } from "../entities";
import type { MembershipId, TeamId } from "../ids";
import type {
  ChatPublisher,
  ForumTopicManager,
  HackathonAnalysisRepo,
  Logger,
  MembershipRepo,
} from "../ports";

export interface UnlinkHackathonFromTopicInput {
  teamId: TeamId;
  actorMembershipId: MembershipId;
  chatId: number;
  // Current message thread (may be null when unlinking by slug from General).
  threadId: number | null;
  // When set, unlink that analysis's linked topic (even if the caller is elsewhere).
  slug?: string;
}

export interface UnlinkHackathonFromTopicDeps {
  membershipRepo: MembershipRepo;
  hackathonAnalysisRepo: HackathonAnalysisRepo;
  chatPublisher: ChatPublisher;
  forumTopicManager: ForumTopicManager;
  logger: Logger;
}

export interface UnlinkHackathonFromTopicResult {
  slug: string;
  topicClosed: boolean;
}

// Admin-only: clear the analysis↔topic link, unpin best-effort, then close the
// forum topic best-effort. Resolve by slug (preferred when provided) or by the
// caller's current threadId ("esta").
export async function unlinkHackathonFromTopic(
  input: UnlinkHackathonFromTopicInput,
  deps: UnlinkHackathonFromTopicDeps,
): Promise<UnlinkHackathonFromTopicResult> {
  const actor = await deps.membershipRepo.get(input.teamId, input.actorMembershipId);
  if (!actor) {
    throw new NotFoundError("Actor membership not found");
  }
  if (actor.role !== "admin") {
    throw new UnauthorizedError("Only a team admin may unlink a hackathon");
  }

  const analysis = await resolveLinkedAnalysis(input, deps);
  const topicThreadId = analysis.threadId;
  if (topicThreadId === null) {
    throw new AnalysisNotFoundError("No hackathon linked to this topic");
  }

  await safeUnpin(input.chatId, analysis.pinnedMessageId, deps);
  await deps.hackathonAnalysisRepo.clearTopicLink(input.teamId, analysis.id);

  const topicClosed = await safeCloseTopic(input.chatId, topicThreadId, input.teamId, deps);
  return { slug: analysis.slug, topicClosed };
}

async function resolveLinkedAnalysis(
  input: UnlinkHackathonFromTopicInput,
  deps: UnlinkHackathonFromTopicDeps,
): Promise<HackathonAnalysis> {
  const slug = input.slug?.trim();
  if (slug) {
    const bySlug = await deps.hackathonAnalysisRepo.findBySlug(input.teamId, slug);
    if (!bySlug) {
      throw new AnalysisNotFoundError("No analysis with that slug. See /hackathons.");
    }
    if (bySlug.threadId === null) {
      throw new AnalysisNotFoundError("No hackathon linked to this topic");
    }
    return bySlug;
  }

  if (input.threadId === null) {
    throw new AnalysisNotFoundError("No hackathon linked to this topic");
  }
  const byThread = await deps.hackathonAnalysisRepo.findByThreadId(
    input.teamId,
    input.threadId,
  );
  if (!byThread) {
    throw new AnalysisNotFoundError("No hackathon linked to this topic");
  }
  return byThread;
}

async function safeUnpin(
  chatId: number,
  messageId: number | null,
  deps: Pick<UnlinkHackathonFromTopicDeps, "chatPublisher" | "logger">,
): Promise<void> {
  if (messageId === null) return;
  try {
    await deps.chatPublisher.unpin(chatId, messageId);
  } catch (err) {
    deps.logger.log({
      event: "hackathon-unlink",
      outcome: "error",
      errorCode: err instanceof Error ? err.name : "UnknownError",
      reason: "unpin-failed",
    });
  }
}

async function safeCloseTopic(
  chatId: number,
  threadId: number,
  teamId: TeamId,
  deps: Pick<UnlinkHackathonFromTopicDeps, "forumTopicManager" | "logger">,
): Promise<boolean> {
  try {
    await deps.forumTopicManager.close(chatId, threadId);
    return true;
  } catch (err) {
    deps.logger.log({
      event: "hackathon-unlink",
      teamId,
      outcome: "error",
      errorCode: err instanceof Error ? err.name : "UnknownError",
      reason: "close-topic-failed",
    });
    return false;
  }
}
