// Slug derivation and collision suffixing (spec hackathon-analysis: "Slug
// Generation and Uniqueness", design.md "Parsing, Normalization, Slugs"). A
// refresh of the same normalized URL never changes the slug — this module
// only derives the CANDIDATE for a brand-new analysis; the caller (the
// analyze-hackathon use case, PR2) is the one that checks the candidate
// against a repo and retries with the next attempt.

const MAX_SLUG_LENGTH = 40;
// A run of anything outside [a-z0-9] becomes a single hyphen.
const NON_SLUG_CHARS = /[^a-z0-9]+/g;
const EDGE_HYPHENS = /^-+|-+$/g;

// Derives the base candidate from the extracted hackathon name, or the URL
// host when no name is available (spec: "First analysis gets the base
// slug"). NFKD strips diacritics (e.g. "é" -> "e" + combining accent, then
// the accent is dropped by NON_SLUG_CHARS).
export function deriveBaseSlug(nameOrHost: string): string {
  const decomposed = nameOrHost.normalize("NFKD").toLowerCase();
  const withoutMarks = decomposed.replace(/[̀-ͯ]/g, "");
  const collapsed = withoutMarks.replace(NON_SLUG_CHARS, "-").replace(EDGE_HYPHENS, "");
  const capped = collapsed.slice(0, MAX_SLUG_LENGTH);
  return capped.replace(EDGE_HYPHENS, "");
}

// Attempt 1 is the base slug itself. Attempts 2-99 append a numeric suffix
// (spec: "Collision appends a numeric suffix"). Attempt 100+ falls back to
// a random hex suffix (design.md) supplied by the caller — this module
// stays pure and never calls crypto directly.
export function slugForAttempt(
  base: string,
  attempt: number,
  randomHex: string,
): string {
  if (attempt <= 1) return base;
  if (attempt <= 99) return `${base}-${attempt}`;
  return `${base}-${randomHex}`;
}
