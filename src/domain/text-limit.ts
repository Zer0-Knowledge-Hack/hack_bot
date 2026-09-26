// Generic line-list truncation shared by `/repos` and `/hackathons` (spec
// hackathon-analysis: "Listing Is Read-Only and Truncated" — "the same
// pattern as /repos"). Telegram rejects a message over 4096 chars; below
// the limit whole lines are kept, and once a line would push the reply
// over the limit, listing stops and a fixed "...and N more" summary line
// replaces the rest (see adapters/telegram/commands.ts's prior `reposReply`,
// which this generalizes).
export function joinLinesWithinLimit(
  lines: string[],
  limit: number,
  emptyMessage = "",
): string {
  if (lines.length === 0) return emptyMessage;

  const full = lines.join("\n");
  if (full.length <= limit) return full;

  for (let kept = lines.length - 1; kept >= 0; kept--) {
    const omitted = lines.length - kept;
    const head = lines.slice(0, kept).join("\n");
    const candidate = kept > 0 ? `${head}\n...and ${omitted} more` : `...and ${omitted} more`;
    if (candidate.length <= limit) return candidate;
  }
  // Pathological case: even the summary line alone does not fit —
  // defensively truncate rather than ever exceed the limit.
  return `...and ${lines.length} more`.slice(0, limit);
}
