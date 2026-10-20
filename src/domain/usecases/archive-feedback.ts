import type { FeedbackStatus } from "../entities";
import type { TeamId } from "../ids";
import type { FeedbackRepo, Logger } from "../ports";

export interface ArchiveFeedbackInput {
  teamId: TeamId;
  noteIds: string[];
  targetStatus?: FeedbackStatus;
}

export interface ArchiveFeedbackDeps {
  feedbackRepo: FeedbackRepo;
  logger: Logger;
}

export async function archiveFeedback(
  input: ArchiveFeedbackInput,
  deps: ArchiveFeedbackDeps,
): Promise<{ updatedCount: number }> {
  if (input.noteIds.length === 0) {
    return { updatedCount: 0 };
  }

  const status = input.targetStatus ?? "triaged";
  await deps.feedbackRepo.updateStatus(input.teamId, input.noteIds, status);

  deps.logger.log({
    event: "feedback-archived",
    teamId: input.teamId,
    outcome: "ok",
  });

  return { updatedCount: input.noteIds.length };
}
