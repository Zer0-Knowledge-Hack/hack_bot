import { NotFoundError, UnauthorizedError } from "../errors";
import type { RepoFullName } from "../github";
import type { MembershipId, TeamId } from "../ids";
import type { MembershipRepo, RepoTopicLinkRepo } from "../ports";

export interface UnlinkRepoInput {
  teamId: TeamId;
  actorMembershipId: MembershipId;
  repo: RepoFullName;
}

export interface UnlinkRepoDeps {
  membershipRepo: MembershipRepo;
  repoTopicLinkRepo: RepoTopicLinkRepo;
}

// Returns false (not an error) when there was nothing to remove — unlinking
// an already-unlinked repo is idempotent, mirroring RepoTopicLinkRepo.remove.
export async function unlinkRepo(
  input: UnlinkRepoInput,
  deps: UnlinkRepoDeps,
): Promise<boolean> {
  const actor = await deps.membershipRepo.get(
    input.teamId,
    input.actorMembershipId,
  );
  if (!actor) {
    throw new NotFoundError("Actor membership not found");
  }
  if (actor.role !== "admin") {
    throw new UnauthorizedError("Only a team admin may unlink a repo");
  }

  return deps.repoTopicLinkRepo.remove(input.teamId, input.repo);
}
