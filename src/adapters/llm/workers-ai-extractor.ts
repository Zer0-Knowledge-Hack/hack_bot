import { ConfigError } from "../../config-error";
import {
  ExtractionFailedError,
  LlmQuotaExceededError,
  type LlmParseFailureCode,
} from "../../domain/errors";
import type { LlmExtraction, LlmExtractor, LlmOutputMeta } from "../../domain/ports";
import { buildMessages } from "./prompt";

// Injected `run`: a minimal structural subset of the real Workers AI
// binding's `env.AI.run(model, inputs, options)` call shape. No real
// `Ai` binding is imported or wired here — this module never reads
// `env.AI` itself (design.md "File Changes": "Injected run"; wiring the
// concrete binding is Phase 10).
export type WorkersAiRun = (
  model: string,
  inputs: Record<string, unknown>,
  options?: { signal?: AbortSignal },
) => Promise<unknown>;

export interface WorkersAiExtractorOptions {
  run: WorkersAiRun;
}

// design.md "Models": "IDs are validated with ^@(cf|hf)/[A-Za-z0-9._/-]+$".
const MODEL_ID_PATTERN = /^@(cf|hf)\/[A-Za-z0-9._/-]+$/;

const TEMPERATURE = 0; // design.md "the call uses temperature: 0"
// Both models are reasoning models: their thinking (reasoning_content) is
// billed against max_tokens, so 1200 could be spent before any JSON answer is
// emitted. 2500 leaves room for the reasoning plus the extraction object.
const MAX_TOKENS = 2500;

// Per-model input override (real-model evidence, production account, bnbchain
// page: 22k chars, ~4.8k prompt tokens, max_tokens 2500):
//   - glm-4.7-flash default or reasoning_effort "low": finish_reason "length",
//     truncated JSON (reasoning ate ~8k chars / 34 s / 117 neurons), so the
//     primary always failed.
//   - glm-4.7-flash with chat_template_kwargs { enable_thinking: false }:
//     finish_reason "stop", valid JSON with all 11 fields, 312 tokens, 4 s.
//   - qwen3-30b-a3b-fp8 default: valid JSON. With enable_thinking false it
//     BREAKS (message.content is null).
// So thinking is disabled for GLM models only; every other model gets the
// plain { messages, temperature, max_tokens } input.
const GLM_MODEL_PREFIX = "@cf/zai-org/glm-";

function modelInputOverrides(modelId: string): Record<string, unknown> {
  return modelId.startsWith(GLM_MODEL_PREFIX)
    ? { chat_template_kwargs: { enable_thinking: false } }
    : {};
}

// Races `promise` against `signal` so a caller-driven abort rejects even
// when the injected `run` never settles on its own. Mirrors
// rendered-fetcher.ts's raceWithSignal — this adapter never starts a
// wall-clock timer of its own, it only reacts to the signal it was given
// (design.md "Time budget": 45 s per LLM attempt, derived by the caller
// from the attempt deadline).
function raceWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(new DOMException("The operation was aborted", "AbortError"));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException("The operation was aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

// Workers AI reports exhaustion as a thrown error. The repo's generated
// runtime types declare `InferenceUpstreamError`/`AiInternalError` as bare
// `extends Error` (no `code`/`status` field), so the only observable signal
// is the message. The documented errors that mean "no more AI today" are
// (developers.cloudflare.com/workers-ai/platform/errors, both HTTP 429):
//   3036 "You have used up your daily free allocation of 10,000 neurons..."
//   3040 "Capacity temporarily exceeded, please try again."
// The keywords below cover both (3036's text has no "quota"/"capacity"/"429"
// word, hence the explicit code and phrase) plus generic 429/rate-limit
// wording. This distinguishes exhaustion from every other model failure
// (spec llm-extraction: "Workers AI Quota Exhaustion Is Reported and
// Non-Retrying").
const QUOTA_ERROR_PATTERN =
  /quota|capacity|429|rate.?limit|daily free allocation|\b(?:3036|3040)\b/i;

function isQuotaExhausted(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return QUOTA_ERROR_PATTERN.test(err.message);
}

// Turns the model's raw output into an LlmExtraction: `value` is the
// `unknown` that hackathon/extraction.ts's validateExtraction is the ONLY
// place trusted to judge (ports.ts "LlmExtractor"), and `meta` is safe parse
// metadata (finish reason, content length, parse-failure code — never content).
// Accepted shapes:
//   - OpenAI-style chat completion `{ choices: [{ message: { content } }] }`
//     (GLM-4.7-Flash and Qwen3-30B-A3B return this shape in chat mode;
//     `content` is `string | null`). Only `choices[0].message.content` is
//     read: `reasoning_content` is chain-of-thought, never the answer. The
//     text may be wrapped in a markdown code fence, which is stripped.
//   - `{ response: string }` (older Workers AI text-generation models),
//     where the string is expected to be a JSON document.
//   - a bare JSON string, or already-structured `{ response: <object> }`.
//
// Unparseable JSON text is NOT thrown here as an ExtractionFailedError:
// `value` is `null` instead, so validateExtraction's existing
// "invalid-shape" rejection handles it uniformly with every other
// content-shape problem, and analyzeHackathon's already-implemented
// primary-then-fallback logic (analyze-hackathon.ts's `extractFields`)
// runs the fallback model exactly as it would for any other unusable
// response — this adapter never bypasses that fallback by throwing on a
// content problem. Throwing here is reserved for `run` itself failing
// (network/model/quota/timeout), never for shape or parse problems.
//
// Tolerant extraction: when a direct parse (after fence stripping) fails, the
// first balanced JSON object in the text is parsed instead (string- and
// escape-aware). If that yields an object it is returned with meta
// { parseFailure: "prose-around", recovered: true } — the failure case is still
// reported so the diagnostics show the model wraps its JSON in prose. The
// recovered value is as untrusted as any other and still goes through
// validateExtraction unchanged.
const CODE_FENCE_PATTERN = /^\s*```[A-Za-z]*\s*\n([\s\S]*?)\n?\s*```\s*$/;

// A finish_reason is a short plain token ("stop", "length", "tool_calls").
// Anything else is replaced by a fixed value so no model text is ever echoed.
const FINISH_REASON_PATTERN = /^[A-Za-z_-]{1,20}$/;

function isPlainObject(value: unknown): boolean {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

type BalancedScan =
  | { kind: "none" } // no "{" in the text
  | { kind: "unterminated" } // a "{" whose matching "}" never arrives
  | { kind: "found"; text: string };

// Finds the first "{" and its matching "}", respecting JSON strings and
// backslash escapes so braces inside string values do not count.
function scanBalancedObject(text: string): BalancedScan {
  const start = text.indexOf("{");
  if (start === -1) return { kind: "none" };
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return { kind: "found", text: text.slice(start, i + 1) };
    }
  }
  return { kind: "unterminated" };
}

interface ParsedText {
  value: unknown;
  parseFailure?: LlmParseFailureCode;
  recovered?: boolean;
}

function tryParse(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function parseJsonText(text: string): ParsedText {
  if (text.trim() === "") return { value: null, parseFailure: "no-content" };
  const fenced = CODE_FENCE_PATTERN.exec(text);
  const body = fenced ? (fenced[1] ?? "") : text;

  const direct = tryParse(body);
  if (direct.ok) {
    return isPlainObject(direct.value)
      ? { value: direct.value }
      : { value: direct.value, parseFailure: "non-object" };
  }

  const scan = scanBalancedObject(body);
  if (scan.kind === "unterminated") return { value: null, parseFailure: "unterminated" };
  if (scan.kind === "found") {
    const inner = tryParse(scan.text);
    if (inner.ok && isPlainObject(inner.value)) {
      return { value: inner.value, parseFailure: "prose-around", recovered: true };
    }
  }
  return { value: null, parseFailure: "not-json" };
}

function withMeta(parsed: ParsedText, meta: LlmOutputMeta): LlmExtraction {
  return {
    value: parsed.value,
    meta: {
      ...meta,
      ...(parsed.parseFailure !== undefined ? { parseFailure: parsed.parseFailure } : {}),
      ...(parsed.recovered === true ? { recovered: true } : {}),
    },
  };
}

function finishReasonOf(first: unknown): string | undefined {
  if (first === null || typeof first !== "object") return undefined;
  const reason = (first as { finish_reason?: unknown }).finish_reason;
  if (typeof reason !== "string") return undefined;
  return FINISH_REASON_PATTERN.test(reason) ? reason : "other";
}

function parseModelOutput(raw: unknown): LlmExtraction {
  if (typeof raw === "string") {
    return withMeta(parseJsonText(raw), { contentLength: raw.length });
  }
  if (raw !== null && typeof raw === "object" && "choices" in raw) {
    const { choices } = raw as { choices: unknown };
    const first: unknown = Array.isArray(choices) ? choices[0] : undefined;
    const message =
      first !== null && typeof first === "object" ? (first as { message?: unknown }).message : undefined;
    const content =
      message !== null && typeof message === "object"
        ? (message as { content?: unknown }).content
        : undefined;
    const finishReason = finishReasonOf(first);
    const base: LlmOutputMeta = {
      ...(finishReason !== undefined ? { finishReason } : {}),
      contentLength: typeof content === "string" ? content.length : 0,
    };
    return typeof content === "string"
      ? withMeta(parseJsonText(content), base)
      : withMeta({ value: null, parseFailure: "no-content" }, base);
  }
  if (raw !== null && typeof raw === "object" && "response" in raw) {
    const { response } = raw as { response: unknown };
    if (typeof response === "string") {
      return withMeta(parseJsonText(response), { contentLength: response.length });
    }
    if (response !== undefined) return { value: response };
    return { value: null };
  }
  return { value: raw };
}

export function createWorkersAiExtractor(options: WorkersAiExtractorOptions): LlmExtractor {
  const { run } = options;

  return {
    async extract(pageText: string, modelId: string, signal: AbortSignal): Promise<LlmExtraction> {
      if (!MODEL_ID_PATTERN.test(modelId)) {
        throw new ConfigError(`invalid Workers AI model id: "${modelId}"`);
      }

      if (signal.aborted) {
        throw new ExtractionFailedError("Workers AI call timed out", "timeout");
      }

      const messages = buildMessages(pageText);

      let raw: unknown;
      try {
        raw = await raceWithSignal(
          Promise.resolve(
            run(
              modelId,
              {
                messages,
                temperature: TEMPERATURE,
                max_tokens: MAX_TOKENS,
                ...modelInputOverrides(modelId),
              },
              { signal },
            ),
          ),
          signal,
        );
      } catch (err) {
        if (signal.aborted) {
          throw new ExtractionFailedError("Workers AI call timed out", "timeout");
        }
        if (isQuotaExhausted(err)) {
          throw new LlmQuotaExceededError("Workers AI shared quota is exhausted for today");
        }
        throw new ExtractionFailedError("Workers AI call failed", "model-error");
      }

      return parseModelOutput(raw);
    },
  };
}
