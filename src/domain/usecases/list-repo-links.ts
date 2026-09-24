import type { RepoTopicLink } from "../entities";
import { NotFoundError } from "../errors";
import type { MembershipId, TeamId } from "../ids";
import type {
  GithubOrgClaimRepo,
  MembershipRepo,
  RepoTopicLinkRepo,
} from "../ports";

export interface ListRepoLinksInput {
  teamId: TeamId;
  actorMembershipId: MembershipId;
}

export interface ListRepoLinksDeps {
  membershipRepo: MembershipRepo;
  repoTopicLinkRepo: RepoTopicLinkRepo;
  githubOrgClaimRepo: GithubOrgClaimRepo;
}

// Any registered member may list (spec: repo-topic-links "Any Member Lists
// the Team's Claimed-Org Links") — no admin check, unlike link/unlink.
// Read-only: never mutates a stored link.
export async function listRepoLinks(
  input: ListRepoLinksInput,
  deps: ListRepoLinksDeps,
): Promise<RepoTopicLink[]> {
  const actor = await deps.membershipRepo.get(
    input.teamId,
    input.actorMembershipId,
  );
  if (!actor) {
    throw new NotFoundError("Actor membership not found");
  }

  const links = await deps.repoTopicLinkRepo.list(input.teamId);
  const results: RepoTopicLink[] = [];
  for (const link of links) {
    // Excludes a link whose org claim was later removed — the link row can
    // outlive the claim (spec: "excludes any link that no longer has a
    // matching org claim").
    const claimed = await deps.githubOrgClaimRepo.isClaimedBy(
      input.teamId,
      link.orgLogin,
    );
    if (claimed) results.push(link);
  }
  return results;
}
