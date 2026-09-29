// Strict schema validation for the LLM's extracted hackathon fields (spec
// llm-extraction: "Strict Schema Output", "Null Over Guess for Every
// Field", "Bounded Source Snippet Per Non-Null Field"). This is the ONLY
// place a raw model response is trusted to become domain data — a top-level
// non-object rejects the whole response (design.md "Validation"), while a
// per-field problem (a wrong-shape field, an unfindable or oversized
// snippet) demotes only that field to null rather than failing the whole
// extraction.

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

// `rejectedCount` (RELI-001) counts fields nulled by content validation —
// an empty/whitespace snippet, an oversized snippet, a non-verbatim
// snippet, or an oversized value — as opposed to fields the model itself
// returned as `null`. The use case layer uses it to decide whether the
// fallback model should be tried or preferred (analyze-hackathon.ts
// "more than half of its fields are invalid").
// Why validation nulled a field. Fixed codes only — safe to log
// (never carries snippet or value text).
export type RejectionReason =
  | "empty-snippet"
  | "snippet-too-long"
  | "not-verbatim"
  | "value-too-long"
  | "wrong-shape"; // missing key, non-object field, wrong value/snippet/confidence type

export interface FieldRejection {
  field: string;
  reason: RejectionReason;
}

export type ValidateExtractionResult =
  | {
      ok: true;
      fields: ExtractedFields;
      rejectedCount: number;
      // One entry per rejected field, in schema order (rejections.length ===
      // rejectedCount). Field NAMES and reason codes only.
      rejections: FieldRejection[];
    }
  | { ok: false; reason: "invalid-shape" };

// spec llm-extraction: "Bounded Source Snippet Per Non-Null Field" — at
// most 200 characters. url.test/tasks.md's "≤160" refers to the snippet
// window used for verbatim-in-page checking below; the stored cap is 200.
const SNIPPET_MAX = 200;

// design.md "Storage": "The validated extraction JSON, bounded; no page
// text" — every string field's `value` is capped so the persisted JSON
// stays bounded even when a field legitimately needs more room than a
// short field like `name` (e.g. `prizes` and `tracks` can describe several
// items in one sentence). 500 is generous enough for those longer fields
// while still rejecting a runaway or hallucinated value (RISK-001: the
// probe showed a 100,000-char `name` passing validation). `teamSize` is
// numeric and unaffected.
const VALUE_MAX = 500;

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

// Exported so analyze-hackathon.ts can compute "more than half of its
// fields are invalid" (design.md "Extraction Schema and Prompt") without
// hardcoding the field count a second time.
export const FIELD_COUNT = FIELD_NAMES.length;

export function validateExtraction(
  raw: unknown,
  pageText: string,
): ValidateExtractionResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: "invalid-shape" };
  }
  const record = raw as Record<string, unknown>;

  // Normalized once per call, not per field (see normalizeWhitespace).
  const normalizedPage = normalizeWhitespace(pageText);
  const fields = {} as ExtractedFields;
  const rejections: FieldRejection[] = [];
  for (const name of FIELD_NAMES) {
    const shaped = shapeField(name, record[name]);
    if (shaped.kind === "null") {
      fields[name] = null;
      continue;
    }
    if (shaped.kind === "wrong-shape") {
      rejections.push({ field: name, reason: "wrong-shape" });
      fields[name] = null;
      continue;
    }
    const sanitized = sanitizeField(shaped.field, normalizedPage);
    // The model supplied a non-null field, but content validation nulled
    // it (RELI-001) — distinct from a field the model itself returned as
    // null, which is never counted as rejected.
    if (typeof sanitized === "string") {
      rejections.push({ field: name, reason: sanitized });
      (fields as unknown as Record<string, unknown>)[name] = null;
      continue;
    }
    (fields as unknown as Record<string, unknown>)[name] = sanitized;
  }

  return { ok: true, fields, rejectedCount: rejections.length, rejections };
}

type ShapedField =
  | { kind: "null" }
  | { kind: "wrong-shape" }
  | { kind: "field"; field: ExtractedField<unknown> };

// Per-field shape check (spec llm-extraction: "Malformed field is rejected
// individually"). Only a top-level non-object fails the whole response; a
// problem with one field costs that field alone.
//   - explicit `null` is the model saying "not found" -> null, not rejected;
//   - an object whose `value` is null is the same statement in the shape GLM
//     actually emits ({ value: null, snippet: null, confidence: 0 }), so it
//     is a model-null whatever its snippet or confidence hold;
//   - a MISSING key, a non-object, a wrong value type (`teamSize` is the
//     only numeric field; every other field is a string), a non-string
//     snippet or a non-number confidence is "wrong-shape": nulled and
//     counted in rejectedCount. A missing key counts as rejected rather than
//     null so a garbage object such as { "unrelated": true } cannot become a
//     usable all-null success: null over guess is an explicit null.
function shapeField(name: keyof ExtractedFields, rawField: unknown): ShapedField {
  if (rawField === null) return { kind: "null" };
  if (typeof rawField !== "object" || Array.isArray(rawField)) return { kind: "wrong-shape" };
  const candidate = rawField as Record<string, unknown>;
  if (candidate.value === null) return { kind: "null" };
  if (
    typeof candidate.snippet !== "string" ||
    typeof candidate.confidence !== "number" ||
    !hasValidFieldType(name, candidate.value)
  ) {
    return { kind: "wrong-shape" };
  }
  return {
    kind: "field",
    field: { value: candidate.value, snippet: candidate.snippet, confidence: candidate.confidence },
  };
}

function hasValidFieldType(name: keyof ExtractedFields, value: unknown): boolean {
  if (name === "teamSize") {
    return typeof value === "number" && Number.isFinite(value);
  }
  return typeof value === "string";
}

// Collapses every run of whitespace (\s covers \n, \r, \t and NBSP U+00A0)
// to one space and trims. html-to-text.ts joins blocks with "\n\n" while
// models copy snippets with flattened whitespace, so a strict byte-for-byte
// containment check rejected genuine quotes. Whitespace is collapsed, never
// removed, so "LocationOnline" still does not match "Location Online".
function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// Demotes a syntactically valid field to null when it fails a content
// guard: an empty/whitespace-only snippet (RISK-001 — trivially "found" in
// any page, defeating the anti-hallucination verbatim check), an oversized
// snippet (spec: "Bounded Source Snippet"), a snippet that is not verbatim
// (modulo whitespace) in the page text (design.md "fields whose snippet is
// not found in the page" become null), or an oversized `value` (RISK-001,
// VALUE_MAX above).
//
// `normalizedPage` is the already-normalized page text. SNIPPET_MAX applies
// to the NORMALIZED snippet: padding whitespace is not content, and the
// stored snippet is the normalized one, so the persisted bound is exactly
// what is checked. Storing the normalized form (rather than the model's raw
// text) also keeps stored snippets single-line and comparable to the page.
function sanitizeField(
  field: ExtractedField<unknown>,
  normalizedPage: string,
): Field<unknown> | RejectionReason {
  const snippet = normalizeWhitespace(field.snippet);
  if (snippet.length === 0) return "empty-snippet";
  if (snippet.length > SNIPPET_MAX) return "snippet-too-long";
  if (!normalizedPage.includes(snippet)) return "not-verbatim";
  if (typeof field.value === "string" && field.value.length > VALUE_MAX) {
    return "value-too-long";
  }
  return { ...field, snippet };
}
