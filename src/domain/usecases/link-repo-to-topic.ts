import { NotFoundError, OrgNotClaimedError, UnauthorizedError } from "../errors";
import type { RepoFullName } from "../github";
import type { MembershipId, TeamId } from "../ids";
import type {
  Clock,
  GithubOrgClaimRepo,
  MembershipRepo,
  RepoTopicLinkRepo,
} from "../ports";

export interface LinkRepoToTopicInput {
  teamId: TeamId;
  actorMembershipId: MembershipId;
  repo: RepoFullName;
  // Caller (adapter) has already refused a null thread — see design.md
  // "Interfaces / Contracts" ("the thread must not be null, the same
  // refusal as /datachannel").
  threadId: number;
}

export interface LinkRepoToTopicDeps {
  membershipRepo: MembershipRepo;
  githubOrgClaimRepo: GithubOrgClaimRepo;
  repoTopicLinkRepo: RepoTopicLinkRepo;
  clock: Clock;
}

export interface LinkRepoToTopicResult {
  repo: RepoFullName;
  // Null on a first link, so the adapter can tell a fresh link from a move
  // (design.md "One Topic Per Repo, Re-Link Moves It").
  previousThreadId: number | null;
}

export async function linkRepoToTopic(
  input: LinkRepoToTopicInput,
  deps: LinkRepoToTopicDeps,
): Promise<LinkRepoToTopicResult> {
  const actor = await deps.membershipRepo.get(
    input.teamId,
    input.actorMembershipId,
  );
  if (!actor) {
    throw new NotFoundError("Actor membership not found");
  }
  if (actor.role !== "admin") {
    throw new UnauthorizedError("Only a team admin may link a repo");
  }

  const orgLogin = orgLoginFromRepo(input.repo);
  const claimed = await deps.githubOrgClaimRepo.isClaimedBy(
    input.teamId,
    orgLogin,
  );
  if (!claimed) {
    throw new OrgNotClaimedError(`Org "${orgLogin}" is not claimed by this team`);
  }

  const existing = await deps.repoTopicLinkRepo.get(input.teamId, input.repo);
  const now = deps.clock.now();
  await deps.repoTopicLinkRepo.upsert(input.teamId, {
    teamId: input.teamId,
    repoFullName: input.repo,
    orgLogin,
    threadId: input.threadId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });

  return { repo: input.repo, previousThreadId: existing?.threadId ?? null };
}

function orgLoginFromRepo(repo: RepoFullName): string {
  return repo.slice(0, repo.indexOf("/"));
}
