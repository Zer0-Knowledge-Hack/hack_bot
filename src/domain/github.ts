// Domain-only GitHub event model. The adapter mapper (adapters/github) is
// the only place that reads raw webhook JSON — the domain never sees
// payload shapes (design.md "Architecture Decisions", Event filtering).

// Branded like TeamId/MemberId (see ids.ts) — always the lowercased
// `owner/repo` shape, never an unchecked string.
export type RepoFullName = string & { readonly __brand: "RepoFullName" };

// Owner and repo segments: at least one alphanumeric, dot, hyphen or
// underscore, no slashes or whitespace inside a segment.
const REPO_FULL_NAME_PATTERN = /^[a-z0-9._-]+\/[a-z0-9._-]+$/;

export function parseRepoFullName(raw: string): RepoFullName | null {
  const lower = raw.trim().toLowerCase();
  return REPO_FULL_NAME_PATTERN.test(lower) ? (lower as RepoFullName) : null;
}

export type GithubEventKind = "pull_request" | "issues";
export type GithubEventAction =
  | "opened"
  | "closed"
  | "merged"
  | "review_requested";

// Allowlisted fields only (design.md "Allowlisted Fields Only, No Payload
// Storage or Logging"). `reviewer` and `actor` are logins only.
export interface GithubEvent {
  org: string;
  repo: RepoFullName;
  kind: GithubEventKind;
  action: GithubEventAction;
  number: number;
  title: string;
  url: string;
  actor: string;
  reviewer?: string;
}

// Telegram's hard limit (design.md "Message"). Title is capped separately
// so one runaway field cannot silently swallow the rest of the message.
const TITLE_MAX = 256;
const MESSAGE_MAX = 4096;

export function formatGithubAlert(event: GithubEvent): string {
  const title = truncate(event.title, TITLE_MAX);
  const lines = [
    `${event.repo} — ${event.kind} ${event.action}`,
    `#${event.number}: ${title}`,
    event.reviewer !== undefined ? `Reviewer: ${event.reviewer}` : null,
    `By: ${event.actor}`,
    event.url,
  ].filter((line): line is string => line !== null);
  return truncate(lines.join("\n"), MESSAGE_MAX);
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}
