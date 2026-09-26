import type { ExtractedFields } from "./extraction";
import { joinLinesWithinLimit } from "../text-limit";

// Plain-text reply formatting for a stored analysis and the `/hackathons`
// listing (spec hackathon-analysis: "Listing Is Read-Only and Truncated",
// "Plain Text Replies"). Both replies stay at most 4096 characters and use
// no `parse_mode` — formatting is plain lines, never markdown/HTML.
const REPLY_MAX = 4096;

const FIELD_LABELS: Record<keyof ExtractedFields, string> = {
  name: "Name",
  format: "Format",
  location: "Location",
  teamSize: "Team size",
  submissionDeadline: "Submission deadline",
  startDate: "Start date",
  endDate: "End date",
  resultsDate: "Results date",
  prizes: "Prizes",
  tracks: "Tracks",
  eligibility: "Eligibility",
};

export interface FormatAnalysisInput {
  slug: string;
  fields: ExtractedFields;
  suggestions: string[];
}

export function formatAnalysis(input: FormatAnalysisInput): string {
  const lines = [`Slug: ${input.slug}`];
  for (const [key, label] of Object.entries(FIELD_LABELS) as Array<
    [keyof ExtractedFields, string]
  >) {
    const field = input.fields[key];
    if (field !== null) lines.push(`${label}: ${field.value}`);
  }
  if (input.suggestions.length > 0) {
    lines.push(`Suggested repos: ${input.suggestions.join(", ")}`);
  }
  return truncate(lines.join("\n"), REPLY_MAX);
}

export interface HackathonListEntry {
  slug: string;
  name: string | null;
  deadline: string | null;
  linked: boolean;
}

const NO_ANALYSES_MESSAGE = "No hackathons analyzed yet.";

export function formatHackathonsList(entries: HackathonListEntry[]): string {
  const lines = entries.map((entry) => {
    const name = entry.name ?? "(unnamed)";
    const deadline = entry.deadline ?? "no deadline found";
    const linked = entry.linked ? "linked" : "not linked";
    return `${entry.slug} — ${name} — ${deadline} — ${linked}`;
  });
  return joinLinesWithinLimit(lines, REPLY_MAX, NO_ANALYSES_MESSAGE);
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}
