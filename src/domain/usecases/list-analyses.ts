import { NotFoundError } from "../errors";
import { formatHackathonsList, type HackathonListEntry } from "../hackathon/format";
import type { MembershipId, TeamId } from "../ids";
import type { HackathonAnalysisRepo, MembershipRepo } from "../ports";

export interface ListAnalysesInput {
  teamId: TeamId;
  actorMembershipId: MembershipId;
}

export interface ListAnalysesDeps {
  membershipRepo: MembershipRepo;
  hackathonAnalysisRepo: HackathonAnalysisRepo;
}

export interface ListAnalysesResult {
  replyText: string;
}

// spec hackathon-analysis "Listing Is Read-Only and Truncated": any
// registered member may list. Read-only — never mutates a stored analysis.
export async function listAnalyses(
  input: ListAnalysesInput,
  deps: ListAnalysesDeps,
): Promise<ListAnalysesResult> {
  const actor = await deps.membershipRepo.get(
    input.teamId,
    input.actorMembershipId,
  );
  if (!actor) {
    throw new NotFoundError("Actor membership not found");
  }

  const analyses = await deps.hackathonAnalysisRepo.listByTeam(input.teamId);
  const entries: HackathonListEntry[] = analyses.map((analysis) => ({
    slug: analysis.slug,
    name: analysis.fields.name?.value ?? null,
    deadline: analysis.fields.submissionDeadline?.value ?? null,
    linked: analysis.threadId !== null,
  }));

  return { replyText: formatHackathonsList(entries) };
}
