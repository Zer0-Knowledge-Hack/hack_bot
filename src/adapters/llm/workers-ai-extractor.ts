import { ConfigError } from "../../config-error";
import { ExtractionFailedError, LlmQuotaExceededError } from "../../domain/errors";
import type { LlmExtractor } from "../../domain/ports";
import { buildPrompt } from "./prompt";

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
const MAX_TOKENS = 1200; // design.md "and max_tokens: 1200"

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

// Turns the model's raw output into the `unknown` value that
// hackathon/extraction.ts's validateExtraction is the ONLY place trusted to
// judge (ports.ts "LlmExtractor"). Workers AI text-generation models
// typically return `{ response: string }`, where the string is expected to
// be a JSON document; some configurations return already-structured JSON
// output directly. Both shapes are accepted so the caller never needs to
// know which one the configured model uses.
//
// Unparseable JSON text is NOT thrown here as an ExtractionFailedError:
// this method returns `null` instead, so validateExtraction's existing
// "invalid-shape" rejection handles it uniformly with every other
// content-shape problem, and analyzeHackathon's already-implemented
// primary-then-fallback logic (analyze-hackathon.ts's `extractFields`)
// runs the fallback model exactly as it would for any other unusable
// response — this adapter never bypasses that fallback by throwing on a
// content problem. Throwing here is reserved for `run` itself failing
// (network/model/quota/timeout), never for shape or parse problems.
function parseModelOutput(raw: unknown): unknown {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (raw !== null && typeof raw === "object" && "response" in raw) {
    const { response } = raw as { response: unknown };
    if (typeof response === "string") {
      try {
        return JSON.parse(response);
      } catch {
        return null;
      }
    }
    if (response !== undefined) return response;
    return null;
  }
  return raw;
}

export function createWorkersAiExtractor(options: WorkersAiExtractorOptions): LlmExtractor {
  const { run } = options;

  return {
    async extract(pageText: string, modelId: string, signal: AbortSignal): Promise<unknown> {
      if (!MODEL_ID_PATTERN.test(modelId)) {
        throw new ConfigError(`invalid Workers AI model id: "${modelId}"`);
      }

      if (signal.aborted) {
        throw new ExtractionFailedError("Workers AI call timed out", "timeout");
      }

      const prompt = buildPrompt(pageText);

      let raw: unknown;
      try {
        raw = await raceWithSignal(
          Promise.resolve(
            run(modelId, { prompt, temperature: TEMPERATURE, max_tokens: MAX_TOKENS }, { signal }),
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
