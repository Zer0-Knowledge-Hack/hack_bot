import { parseRepoFullName } from "../../domain/github";
import type {
  GithubEvent,
  GithubEventAction,
  GithubEventKind,
} from "../../domain/github";

// Adapter mapper (design.md "Architecture Decisions", Event filtering): the
// ONLY place that reads raw GitHub webhook JSON. Reads only the allowlisted
// fields needed for GithubEvent — never a commit author, an email, or any
// other payload field — and returns null for anything outside the
// supported event/action set (spec: github-webhook "Unsupported Event or
// Action Ignored"). The domain never sees this payload shape.

const SUPPORTED_PR_ACTIONS = new Set(["opened", "closed", "review_requested"]);
const SUPPORTED_ISSUE_ACTIONS = new Set(["opened", "closed"]);

interface RawPayload {
  action?: unknown;
  number?: unknown;
  sender?: { login?: unknown };
  repository?: { full_name?: unknown };
  pull_request?: { title?: unknown; html_url?: unknown; merged?: unknown };
  issue?: { title?: unknown; html_url?: unknown };
  requested_reviewer?: { login?: unknown };
  requested_team?: { slug?: unknown };
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function mapGithubEvent(
  githubEventType: string,
  payload: unknown,
): GithubEvent | null {
  if (githubEventType !== "pull_request" && githubEventType !== "issues") {
    return null;
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return null;
  }
  const raw = payload as RawPayload;

  const fullName = asString(raw.repository?.full_name);
  const repo = fullName !== null ? parseRepoFullName(fullName) : null;
  if (!repo) return null;
  // Derived from the already-lowercased, validated repo (design.md/task 4.1:
  // "org and repo are lowercased consistently with parseRepoFullName and the
  // claim repo"), never from a separately-cased payload field. `repo`
  // already matched REPO_FULL_NAME_PATTERN, so the "/" split always yields
  // a non-empty first segment.
  const org = repo.slice(0, repo.indexOf("/"));

  const action = asString(raw.action);
  const number = typeof raw.number === "number" ? raw.number : null;
  const actor = asString(raw.sender?.login);
  if (action === null || number === null || actor === null) return null;

  const kind: GithubEventKind = githubEventType;
  let resolvedAction: GithubEventAction;
  let title: string | null;
  let url: string | null;
  let reviewer: string | undefined;

  if (kind === "pull_request") {
    if (!SUPPORTED_PR_ACTIONS.has(action)) return null;
    title = asString(raw.pull_request?.title);
    url = asString(raw.pull_request?.html_url);

    if (action === "closed") {
      resolvedAction = raw.pull_request?.merged === true ? "merged" : "closed";
    } else if (action === "review_requested") {
      resolvedAction = "review_requested";
      reviewer =
        asString(raw.requested_reviewer?.login) ??
        asString(raw.requested_team?.slug) ??
        undefined;
    } else {
      resolvedAction = "opened";
    }
  } else {
    if (!SUPPORTED_ISSUE_ACTIONS.has(action)) return null;
    resolvedAction = action as GithubEventAction;
    title = asString(raw.issue?.title);
    url = asString(raw.issue?.html_url);
  }

  if (title === null || url === null) return null;

  return {
    org,
    repo,
    kind,
    action: resolvedAction,
    number,
    title,
    url,
    actor,
    ...(reviewer !== undefined ? { reviewer } : {}),
  };
}
