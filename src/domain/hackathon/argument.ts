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

export type JoinArgument =
  | { kind: "join"; slug: string }
  | { kind: "join-usage" };

// `/hackathon join <slug>` (hackathon-participation design.md decision 6).
// Checked BEFORE the whitespace rule of the classic argument handling: a bare
// `join`, a non-slug target or extra tokens all yield the usage line; any
// other argument returns null so the existing rules apply unchanged.
export function parseJoinArgument(raw: string): JoinArgument | null {
  const match = /^join(?:\s+(.*))?$/su.exec(raw.trim());
  if (!match) return null;
  const rest = (match[1] ?? "").trim();
  if (rest === "" || /\s/u.test(rest)) return { kind: "join-usage" };
  const isSlug = SLUG_PATTERN.test(rest);
  return isSlug ? { kind: "join", slug: rest } : { kind: "join-usage" };
}
