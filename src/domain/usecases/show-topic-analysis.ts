import { NotFoundError } from "../errors";
import { formatAnalysis } from "../hackathon/format";
import type { MembershipId, TeamId } from "../ids";
import type { HackathonAnalysisRepo, MembershipRepo } from "../ports";

export interface ShowTopicAnalysisInput {
  teamId: TeamId;
  actorMembershipId: MembershipId;
  threadId: number;
}

export interface ShowTopicAnalysisDeps {
  membershipRepo: MembershipRepo;
  hackathonAnalysisRepo: HackathonAnalysisRepo;
}

export interface ShowTopicAnalysisResult {
  replyText: string;
}

// spec hackathon-analysis "No-Argument Behavior Depends on Topic Linking":
// any registered member sees the topic's linked analysis; `null` means
// nothing is linked and the caller replies with usage instead. Like
// `showAnalysis`, it never depends on `AnalysisQuota`, so it can never count
// against the daily cap.
export async function showTopicAnalysis(
  input: ShowTopicAnalysisInput,
  deps: ShowTopicAnalysisDeps,
): Promise<ShowTopicAnalysisResult | null> {
  const actor = await deps.membershipRepo.get(input.teamId, input.actorMembershipId);
  if (!actor) {
    throw new NotFoundError("Actor membership not found");
  }

  const analysis = await deps.hackathonAnalysisRepo.findByThreadId(input.teamId, input.threadId);
  if (!analysis) return null;

  return {
    replyText: formatAnalysis({
      slug: analysis.slug,
      fields: analysis.fields,
      suggestions: analysis.suggestedRepos,
    }),
  };
}
