import { analysisCopy, FIELD_LABELS } from "../copy";
import type { ExtractedFields } from "./extraction";
import { joinLinesWithinLimit } from "../text-limit";

// Plain-text reply formatting for a stored analysis and the `/hackathons`
// listing (spec hackathon-analysis: "Listing Is Read-Only and Truncated",
// "Plain Text Replies"). Both replies stay at most 4096 characters and use
// no `parse_mode` — formatting is plain lines, never markdown/HTML.
export const REPLY_MAX = 4096;

export interface FormatAnalysisInput {
  slug: string;
  fields: ExtractedFields;
  suggestions: string[];
}

export function formatAnalysis(input: FormatAnalysisInput): string {
  const lines = [`${analysisCopy.slugLabel}: ${input.slug}`];
  for (const [key, label] of Object.entries(FIELD_LABELS) as Array<
    [keyof ExtractedFields, string]
  >) {
    const field = input.fields[key];
    if (field !== null) lines.push(`${label}: ${field.value}`);
  }
  if (input.suggestions.length > 0) {
    lines.push(`${analysisCopy.suggestedReposLabel}: ${input.suggestions.join(", ")}`);
  }
  return truncate(lines.join("\n"), REPLY_MAX);
}

export interface HackathonListEntry {
  slug: string;
  name: string | null;
  deadline: string | null;
  linked: boolean;
}

export function formatHackathonsList(entries: HackathonListEntry[]): string {
  const lines = entries.map((entry) => {
    const name = entry.name ?? analysisCopy.unnamed;
    const deadline = entry.deadline ?? analysisCopy.noDeadline;
    const linked = entry.linked ? analysisCopy.linked : analysisCopy.notLinked;
    return `${entry.slug} — ${name} — ${deadline} — ${linked}`;
  });
  return joinLinesWithinLimit(lines, REPLY_MAX, analysisCopy.noAnalyses);
}

export function truncate(text: string, max: number): string {
  if (max <= 0) return "";
  return text.length > max ? text.slice(0, max) : text;
}
