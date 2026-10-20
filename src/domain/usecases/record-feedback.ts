import type { FeedbackNote, FeedbackSource } from "../entities";
import type { MembershipId, TeamId } from "../ids";
import type { Clock, FeedbackRepo, IdGen, Logger, RepoTopicLinkRepo } from "../ports";

export interface RecordFeedbackInput {
  teamId: TeamId;
  authorMembershipId: MembershipId;
  threadId: number | null;
  rawText: string;
  repoHint?: string | null;
  sourceType?: FeedbackSource;
}

export interface RecordFeedbackDeps {
  feedbackRepo: FeedbackRepo;
  repoTopicLinkRepo: RepoTopicLinkRepo;
  idGen: IdGen;
  clock: Clock;
  logger: Logger;
}

export async function recordFeedback(
  input: RecordFeedbackInput,
  deps: RecordFeedbackDeps,
): Promise<FeedbackNote> {
  let resolvedRepo = input.repoHint?.trim() || null;

  if (!resolvedRepo && input.threadId !== null) {
    const links = await deps.repoTopicLinkRepo.list(input.teamId);
    const matched = links.find((l) => l.threadId === input.threadId);
    if (matched) {
      resolvedRepo = matched.repoFullName;
    }
  }

  const now = deps.clock.now();
  const note: FeedbackNote = {
    id: deps.idGen.newId(),
    teamId: input.teamId,
    authorMembershipId: input.authorMembershipId,
    repoHint: resolvedRepo,
    rawText: input.rawText.trim(),
    sourceType: input.sourceType ?? "text",
    status: "inbox",
    createdAt: now,
    updatedAt: now,
  };

  await deps.feedbackRepo.save(input.teamId, note);

  deps.logger.log({
    event: "feedback-recorded",
    teamId: input.teamId,
    membershipId: input.authorMembershipId,
    outcome: "ok",
  });

  return note;
}
