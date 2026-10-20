import type { FeedbackNote } from "../entities";
import type { TeamId } from "../ids";
import type { FeedbackRepo, Logger, RepoTopicLinkRepo } from "../ports";

export interface FeedbackSynthesizer {
  summarize(notes: FeedbackNote[], signal?: AbortSignal): Promise<string>;
}

export interface SynthesizeFeedbackInput {
  teamId: TeamId;
  threadId?: number | null;
  repoHint?: string | null;
  since?: number;
  limit?: number;
  signal?: AbortSignal;
}

export interface SynthesizedFeedbackSummary {
  repoHint: string | null;
  totalNotes: number;
  startDate: number | null;
  endDate: number | null;
  summaryText: string;
  noteIds: string[];
}

export interface SynthesizeFeedbackDeps {
  feedbackRepo: FeedbackRepo;
  repoTopicLinkRepo: RepoTopicLinkRepo;
  synthesizer: FeedbackSynthesizer;
  logger: Logger;
}

export async function synthesizeFeedback(
  input: SynthesizeFeedbackInput,
  deps: SynthesizeFeedbackDeps,
): Promise<SynthesizedFeedbackSummary> {
  let resolvedRepo = input.repoHint?.trim() || null;

  if (!resolvedRepo && input.threadId !== undefined && input.threadId !== null) {
    const links = await deps.repoTopicLinkRepo.list(input.teamId);
    const matched = links.find((l) => l.threadId === input.threadId);
    if (matched) {
      resolvedRepo = matched.repoFullName;
    }
  }

  const notes = await deps.feedbackRepo.list(input.teamId, {
    repoHint: resolvedRepo ?? undefined,
    status: "inbox",
    since: input.since,
    limit: input.limit ?? 30,
  });

  if (notes.length === 0) {
    return {
      repoHint: resolvedRepo,
      totalNotes: 0,
      startDate: null,
      endDate: null,
      summaryText: "",
      noteIds: [],
    };
  }

  const sortedNotes = [...notes].sort((a, b) => a.createdAt - b.createdAt);
  const startDate = sortedNotes[0]?.createdAt ?? null;
  const endDate = sortedNotes[sortedNotes.length - 1]?.createdAt ?? null;

  const summaryText = await deps.synthesizer.summarize(sortedNotes, input.signal);

  deps.logger.log({
    event: "feedback-synthesized",
    teamId: input.teamId,
    outcome: "ok",
  });

  return {
    repoHint: resolvedRepo,
    totalNotes: notes.length,
    startDate,
    endDate,
    summaryText,
    noteIds: sortedNotes.map((n) => n.id),
  };
}
