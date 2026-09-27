import { AnalysisNotFoundError, NotFoundError } from "../errors";
import { formatAnalysis } from "../hackathon/format";
import type { MembershipId, TeamId } from "../ids";
import type { HackathonAnalysisRepo, MembershipRepo } from "../ports";

export interface ShowAnalysisInput {
  teamId: TeamId;
  actorMembershipId: MembershipId;
  slug: string;
}

export interface ShowAnalysisDeps {
  membershipRepo: MembershipRepo;
  hackathonAnalysisRepo: HackathonAnalysisRepo;
}

export interface ShowAnalysisResult {
  replyText: string;
}

// spec hackathon-analysis "Any Member Re-Shows by Slug, Free of Cap": any
// registered member (not just an admin) may re-show a stored analysis.
// AnalysisQuota is never a dependency here — that alone proves this path
// cannot count against the daily cap.
export async function showAnalysis(
  input: ShowAnalysisInput,
  deps: ShowAnalysisDeps,
): Promise<ShowAnalysisResult> {
  const actor = await deps.membershipRepo.get(
    input.teamId,
    input.actorMembershipId,
  );
  if (!actor) {
    throw new NotFoundError("Actor membership not found");
  }

  const analysis = await deps.hackathonAnalysisRepo.findBySlug(
    input.teamId,
    input.slug,
  );
  if (!analysis) {
    throw new AnalysisNotFoundError("No analysis with that slug. See /hackathons.");
  }

  return {
    replyText: formatAnalysis({
      slug: analysis.slug,
      fields: analysis.fields,
      suggestions: analysis.suggestedRepos,
    }),
  };
}
