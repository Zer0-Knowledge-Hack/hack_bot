import type { FeedbackNote, FeedbackStatus } from "../entities";
import type { TeamId } from "../ids";
import type { FeedbackRepo, RepoTopicLinkRepo } from "../ports";

export interface ListFeedbackInput {
  teamId: TeamId;
  threadId?: number | null;
  repoHint?: string | null;
  status?: FeedbackStatus;
  since?: number;
  limit?: number;
}

export interface ListFeedbackDeps {
  feedbackRepo: FeedbackRepo;
  repoTopicLinkRepo: RepoTopicLinkRepo;
}

export async function listFeedback(
  input: ListFeedbackInput,
  deps: ListFeedbackDeps,
): Promise<FeedbackNote[]> {
  let resolvedRepo = input.repoHint?.trim() || undefined;

  if (!resolvedRepo && input.threadId !== undefined && input.threadId !== null) {
    const links = await deps.repoTopicLinkRepo.list(input.teamId);
    const matched = links.find((l) => l.threadId === input.threadId);
    if (matched) {
      resolvedRepo = matched.repoFullName;
    }
  }

  return await deps.feedbackRepo.list(input.teamId, {
    repoHint: resolvedRepo,
    status: input.status ?? "inbox",
    since: input.since,
    limit: input.limit,
  });
}
