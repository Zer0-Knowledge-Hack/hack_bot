import { ConfigError } from "../../config-error";
import { IntentClassificationError, LlmQuotaExceededError } from "../../domain/errors";
import {
  NL_INTENT_IDS,
  parseIntentResult,
  type IntentClassifierInput,
  type IntentResult,
} from "../../domain/nl/intents";
import type { IntentClassifier } from "../../domain/ports";

// Same catalog pattern as the hackathon extractor.
const MODEL_ID_PATTERN = /^@(cf|hf)\/[A-Za-z0-9._/-]+$/;
const QUOTA_ERROR_PATTERN = /quota|rate.?limit|429/i;
const TEMPERATURE = 0;
const MAX_TOKENS = 400;

// Same GLM override as workers-ai-extractor: default thinking burns max_tokens
// and leaves message.content null / truncated. Qwen breaks if thinking is
// forced off — only apply to @cf/zai-org/glm-* ids.
const GLM_MODEL_PREFIX = "@cf/zai-org/glm-";

function modelInputOverrides(modelId: string): Record<string, unknown> {
  return modelId.startsWith(GLM_MODEL_PREFIX)
    ? { chat_template_kwargs: { enable_thinking: false } }
    : {};
}

export type WorkersAiRun = (
  model: string,
  inputs: Record<string, unknown>,
  options?: { signal?: AbortSignal },
) => Promise<unknown>;

export interface WorkersAiIntentClassifierOptions {
  run: WorkersAiRun;
  modelId: string;
}

const SYSTEM_PROMPT = `You classify Spanish Telegram messages for a hackathon team bot.
Reply with ONLY a JSON object: {"intent":"<id>","confidence":0.0-1.0,"slots":{...}}.
Allowed intent ids: ${NL_INTENT_IDS.join(", ")}.
Slots (optional strings): slug, url, repo, membershipId, profileField, profileValue, targetName.
profileField must be one of: full_name, emails, social_links, github_username.
For hackathon names in natural language (e.g. "BNB Chain", "Meta VR"), put the human name in targetName — do NOT invent slugs.
In a forum topic, "esta/este hackathon" with no name → unlink_hackathon_topic or link_hackathon_topic with empty slug/targetName (topic context).
If unsure, use intent "unknown" with low confidence. Never invent intents.`;

function isQuotaExhausted(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return QUOTA_ERROR_PATTERN.test(err.message);
}

function raceWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
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

function extractContent(raw: unknown): string | null {
  if (typeof raw === "string") return raw;
  if (raw !== null && typeof raw === "object" && "choices" in raw) {
    const { choices } = raw as { choices: unknown };
    const first: unknown = Array.isArray(choices) ? choices[0] : undefined;
    const message =
      first !== null && typeof first === "object"
        ? (first as { message?: unknown }).message
        : undefined;
    const content =
      message !== null && typeof message === "object"
        ? (message as { content?: unknown }).content
        : undefined;
    return typeof content === "string" ? content : null;
  }
  if (raw !== null && typeof raw === "object" && "response" in raw) {
    const { response } = raw as { response: unknown };
    return typeof response === "string" ? response : null;
  }
  return null;
}

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /^\s*```[A-Za-z]*\s*\n([\s\S]*?)\n?\s*```\s*$/.exec(trimmed);
  const body = fenced ? (fenced[1] ?? "") : trimmed;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new IntentClassificationError("Intent classifier returned non-JSON", "bad-output");
  }
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    throw new IntentClassificationError("Intent classifier returned invalid JSON", "bad-output");
  }
}

export function createWorkersAiIntentClassifier(
  options: WorkersAiIntentClassifierOptions,
): IntentClassifier {
  const { run, modelId } = options;

  return {
    async classify(input: IntentClassifierInput, signal: AbortSignal): Promise<IntentResult> {
      if (!MODEL_ID_PATTERN.test(modelId)) {
        throw new ConfigError("NL_MODEL_PRIMARY is missing or not a valid Workers AI model id");
      }
      if (signal.aborted) {
        throw new IntentClassificationError("Intent classifier timed out", "timeout");
      }

      const messages = [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            text: input.text,
            localeHint: input.localeHint,
            context: input.context,
          }),
        },
      ];

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
          throw new IntentClassificationError("Intent classifier timed out", "timeout");
        }
        if (isQuotaExhausted(err)) {
          throw new LlmQuotaExceededError("Workers AI shared quota is exhausted for today");
        }
        throw new IntentClassificationError("Intent classifier call failed", "model-error");
      }

      const content = extractContent(raw);
      if (content === null) {
        throw new IntentClassificationError("Intent classifier returned empty content", "bad-output");
      }
      const parsed = parseIntentResult(parseJsonObject(content));
      if (parsed === null) {
        throw new IntentClassificationError("Intent classifier returned bad shape", "bad-output");
      }
      return parsed;
    },
  };
}
