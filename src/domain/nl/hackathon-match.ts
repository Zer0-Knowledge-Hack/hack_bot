import type { HackathonAnalysis } from "../entities";

export interface HackathonMatchCandidate {
  slug: string;
  name: string;
  threadId: number | null;
}

export function analysisToMatchCandidate(analysis: HackathonAnalysis): HackathonMatchCandidate {
  const name = analysis.fields.name?.value?.trim() || analysis.slug;
  return { slug: analysis.slug, name, threadId: analysis.threadId };
}

// Lowercase, strip accents/punctuation, collapse spaces — shared by NL name match.
export function normalizeHackathonQuery(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function scoreCandidate(candidate: HackathonMatchCandidate, query: string, tokens: string[]): number {
  const slug = normalizeHackathonQuery(candidate.slug);
  const name = normalizeHackathonQuery(candidate.name);
  const hay = `${slug} ${name}`;
  if (slug === query || name === query) return 100;
  if (query.length >= 3 && (slug.includes(query) || name.includes(query))) return 80;
  if (tokens.length === 0) return 0;
  const hits = tokens.filter((token) => token.length > 1 && hay.includes(token)).length;
  if (hits === 0) return 0;
  if (hits === tokens.length) return 60;
  return 30 + hits * 10;
}

// Rank analyses against a free-text query (name or slug fragment). Returns
// best matches only (tied top band), empty when nothing is plausible.
export function matchHackathons(
  candidates: HackathonMatchCandidate[],
  rawQuery: string,
): HackathonMatchCandidate[] {
  const query = normalizeHackathonQuery(rawQuery);
  if (query.length === 0) return [];
  const tokens = query.split(" ").filter((token) => token.length > 0);

  const scored = candidates
    .map((candidate) => ({ candidate, score: scoreCandidate(candidate, query, tokens) }))
    .filter((row) => row.score >= 40)
    .sort((a, b) => b.score - a.score || a.candidate.slug.localeCompare(b.candidate.slug));

  if (scored.length === 0) return [];
  const top = scored[0]!.score;
  // Keep the top band (exact/includes stay alone; token ties disambiguate).
  const band = top >= 80 ? top : Math.max(40, top - 10);
  return scored.filter((row) => row.score >= band).map((row) => row.candidate);
}
