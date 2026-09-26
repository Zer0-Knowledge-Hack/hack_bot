// Strict schema validation for the LLM's extracted hackathon fields (spec
// llm-extraction: "Strict Schema Output", "Null Over Guess for Every
// Field", "Bounded Source Snippet Per Non-Null Field"). This is the ONLY
// place a raw model response is trusted to become domain data — invalid
// shape rejects the whole response (design.md "Validation"), while a
// per-field problem (an unfindable or oversized snippet) demotes only that
// field to null rather than failing the whole extraction.

// A field is either present with a bounded, verbatim-checkable snippet, or
// entirely absent (null over guess).
export interface ExtractedField<T> {
  value: T;
  snippet: string;
  confidence: number;
}

export type Field<T> = ExtractedField<T> | null;

export interface ExtractedFields {
  name: Field<string>;
  format: Field<string>;
  location: Field<string>;
  teamSize: Field<number>;
  submissionDeadline: Field<string>;
  startDate: Field<string>;
  endDate: Field<string>;
  resultsDate: Field<string>;
  prizes: Field<string>;
  tracks: Field<string>;
  eligibility: Field<string>;
}

export type ValidateExtractionResult =
  | { ok: true; fields: ExtractedFields }
  | { ok: false; reason: "invalid-shape" };

// spec llm-extraction: "Bounded Source Snippet Per Non-Null Field" — at
// most 200 characters. url.test/tasks.md's "≤160" refers to the snippet
// window used for verbatim-in-page checking below; the stored cap is 200.
const SNIPPET_MAX = 200;

const FIELD_NAMES: Array<keyof ExtractedFields> = [
  "name",
  "format",
  "location",
  "teamSize",
  "submissionDeadline",
  "startDate",
  "endDate",
  "resultsDate",
  "prizes",
  "tracks",
  "eligibility",
];

export function validateExtraction(
  raw: unknown,
  pageText: string,
): ValidateExtractionResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: "invalid-shape" };
  }
  const record = raw as Record<string, unknown>;

  const fields = {} as ExtractedFields;
  for (const name of FIELD_NAMES) {
    if (!(name in record)) {
      return { ok: false, reason: "invalid-shape" };
    }
    const rawField = record[name];
    if (rawField === null) {
      fields[name] = null;
      continue;
    }
    if (typeof rawField !== "object" || Array.isArray(rawField)) {
      return { ok: false, reason: "invalid-shape" };
    }
    const candidate = rawField as Record<string, unknown>;
    if (
      !("value" in candidate) ||
      typeof candidate.snippet !== "string" ||
      typeof candidate.confidence !== "number"
    ) {
      return { ok: false, reason: "invalid-shape" };
    }
    const sanitized = sanitizeField(
      { value: candidate.value, snippet: candidate.snippet, confidence: candidate.confidence },
      pageText,
    );
    (fields as unknown as Record<string, unknown>)[name] = sanitized;
  }

  return { ok: true, fields };
}

// Demotes a syntactically valid field to null when it fails a content
// guard: an oversized snippet (spec: "Bounded Source Snippet") or a snippet
// that is not verbatim in the page text (design.md "fields whose snippet
// is not found in the page" become null).
function sanitizeField(
  field: ExtractedField<unknown>,
  pageText: string,
): Field<unknown> {
  if (field.snippet.length > SNIPPET_MAX) return null;
  if (!pageText.includes(field.snippet)) return null;
  return field;
}
