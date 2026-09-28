import type { RepoFullName } from "../../domain/github";
import type { RepoMetadataSource } from "../../domain/ports";

// Public GitHub repo metadata used to enrich a suggested repo (design.md
// "Data Flow": "repoLinks+metadata"; ports.ts "RepoMetadataSource"). This
// is a best-effort enrichment, never a hard dependency of the analysis
// pipeline: ANY failure (network error, non-2xx, malformed body, missing
// description, or the 3 s timeout below) returns `null` rather than
// throwing, so a GitHub outage never fails a hackathon analysis.
//
// The GitHub REST API is public and unauthenticated here — no token is
// sent, matching the scope of this adapter (repo metadata only, no
// write access, no rate-limit-boosted calls).

const GITHUB_API_BASE = "https://api.github.com";
const TIMEOUT_MS = 3000; // design.md "Time budget": "GitHub metadata 3 s per call"
const USER_AGENT = "hack-bot-hackathon-analysis";

export interface RepoMetadataSourceOptions {
  fetch: typeof fetch;
}

export function createGithubRepoMetadataSource(
  options: RepoMetadataSourceOptions,
): RepoMetadataSource {
  const doFetch = options.fetch;

  return {
    async fetchDescription(repo: RepoFullName): Promise<string | null> {
      let response: Response;
      try {
        response = await doFetch(`${GITHUB_API_BASE}/repos/${repo}`, {
          method: "GET",
          signal: AbortSignal.timeout(TIMEOUT_MS),
          headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": USER_AGENT,
          },
        });
      } catch {
        // Network error, or the AbortSignal.timeout fired — either way this
        // is a best-effort enrichment call, never a hard failure.
        return null;
      }

      if (!response.ok) return null;

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return null;
      }

      if (
        body !== null &&
        typeof body === "object" &&
        "description" in body &&
        typeof (body as { description: unknown }).description === "string" &&
        (body as { description: string }).description.trim().length > 0
      ) {
        return (body as { description: string }).description;
      }
      return null;
    },
  };
}
