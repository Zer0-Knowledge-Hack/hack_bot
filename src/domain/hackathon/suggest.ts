// Deterministic repo suggestions for a fresh analysis (design.md
// "Suggestions": token overlap, top 3, stored — no extra LLM call, never
// recomputed on show). Pure and order-stable: the same inputs always
// produce the same ranked list, ties broken by input order.

const TOKEN_PATTERN = /[a-z0-9]+/g;

function tokenize(text: string): Set<string> {
  return new Set(text.toLowerCase().match(TOKEN_PATTERN) ?? []);
}

const MAX_SUGGESTIONS = 3;

// `repos` is a list of `owner/repo` full names already known to the team
// (design.md keeps this deterministic — no fuzzy matching or external
// lookup). Any repo with zero shared tokens with the hackathon name is
// dropped; the rest are ranked by shared-token count, highest first.
export function suggestRepos(hackathonName: string, repos: string[]): string[] {
  const nameTokens = tokenize(hackathonName);

  const scored = repos
    .map((repo, index) => {
      const repoTokens = tokenize(repo.split("/")[1] ?? repo);
      let overlap = 0;
      for (const token of repoTokens) {
        if (nameTokens.has(token)) overlap += 1;
      }
      return { repo, overlap, index };
    })
    .filter((entry) => entry.overlap > 0);

  scored.sort((a, b) => b.overlap - a.overlap || a.index - b.index);

  return scored.slice(0, MAX_SUGGESTIONS).map((entry) => entry.repo);
}
