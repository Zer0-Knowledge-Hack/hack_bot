import { AlertSendFailedError, NotFoundError } from "../errors";
import type { AlertSendFailureClass } from "../errors";
import { formatGithubAlert } from "../github";
import type { GithubEvent } from "../github";
import type { TeamId } from "../ids";
import type {
  AlertSender,
  GithubOrgClaimRepo,
  RepoTopicLinkRepo,
  TeamRepo,
} from "../ports";

export interface RouteGithubEventDeps {
  githubOrgClaimRepo: GithubOrgClaimRepo;
  repoTopicLinkRepo: RepoTopicLinkRepo;
  teamRepo: TeamRepo;
  alertSender: AlertSender;
}

export type RouteGithubEventResult =
  | { kind: "delivered"; teamId: TeamId }
  // PR4 correction (RES-001): failureClass is AlertSendFailedError's fixed,
  // non-sensitive classification — carried through so the HTTP adapter can
  // log a distinguishable reason without ever seeing Telegram's raw error.
  | { kind: "send-failed"; teamId: TeamId; failureClass: AlertSendFailureClass }
  | { kind: "ignored"; reason: "unclaimed-org" | "unlinked-repo" };

// design.md "GitHub route status policy": unclaimed org or unlinked repo
// produce no alert and no error (200, ignored). A send failure is caught
// here and reported as "send-failed", not thrown, so the HTTP adapter can
// still return 2xx (GitHub does not need to retry a permanent delivery
// failure like a deleted topic). Any other failure (e.g. D1) propagates so
// the adapter returns 500 and the delivery stays visible for a manual
// redeliver.
export async function routeGithubEvent(
  event: GithubEvent,
  deps: RouteGithubEventDeps,
): Promise<RouteGithubEventResult> {
  const teamId = await deps.githubOrgClaimRepo.findTeamByOrg(event.org);
  if (!teamId) {
    return { kind: "ignored", reason: "unclaimed-org" };
  }

  const link = await deps.repoTopicLinkRepo.get(teamId, event.repo);
  if (!link) {
    return { kind: "ignored", reason: "unlinked-repo" };
  }

  const team = await deps.teamRepo.get(teamId);
  if (!team) {
    // A claim/link exists but the team row is gone — a data-integrity
    // problem, not a normal "no alert" case, so this propagates as a 500.
    throw new NotFoundError("Team not found for a claimed org");
  }

  const text = formatGithubAlert(event);
  try {
    await deps.alertSender.send(team.chatId, link.threadId, text);
  } catch (err) {
    if (err instanceof AlertSendFailedError) {
      return { kind: "send-failed", teamId, failureClass: err.failureClass };
    }
    throw err;
  }

  return { kind: "delivered", teamId };
}
