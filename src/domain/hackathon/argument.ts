// Classifies a bare `/hackathon` argument as a slug lookup or a fresh-URL
// analysis (spec hackathon-analysis: "Argument Classified as Slug or URL").
// This is intentionally the ONLY test performed on the raw string — slug
// existence is checked later by a repo lookup, and URL safety is checked
// later by `assertSafeUrl` (url.ts). Classification never fails: anything
// that is not slug-shaped is treated as a URL and left to the URL guard to
// accept or refuse.

export type HackathonArgument =
  | { kind: "slug"; value: string }
  | { kind: "url"; value: string };

// No `.` or `:` and only lowercase alphanumeric groups joined by single
// hyphens — matches the slugs this system itself generates (slug.ts).
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function classifyHackathonArgument(raw: string): HackathonArgument {
  const isSlugShaped =
    SLUG_PATTERN.test(raw) && !raw.includes(".") && !raw.includes(":");
  return isSlugShaped ? { kind: "slug", value: raw } : { kind: "url", value: raw };
}
