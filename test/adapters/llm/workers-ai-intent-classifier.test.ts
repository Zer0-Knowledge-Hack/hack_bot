import { describe, expect, it } from "vitest";
import {
  createWorkersAiIntentClassifier,
  type WorkersAiRun,
} from "../../../src/adapters/llm/workers-ai-intent-classifier";
import { ConfigError } from "../../../src/config-error";
import { IntentClassificationError, LlmQuotaExceededError } from "../../../src/domain/errors";
import type { IntentClassifierInput } from "../../../src/domain/nl/intents";

const VALID_MODEL = "@cf/meta/llama-3.3-70b";

function neverAborts(): AbortSignal {
  return new AbortController().signal;
}

function baseInput(text = "mostrame los hackathons"): IntentClassifierInput {
  return {
    text,
    localeHint: "es",
    context: { inTopic: false, inDataChannel: false, replyKind: "none" },
  };
}

describe("createWorkersAiIntentClassifier", () => {
  it("validates the model id before calling run", async () => {
    let calls = 0;
    const run: WorkersAiRun = async () => {
      calls += 1;
      return { response: "{}" };
    };
    const classifier = createWorkersAiIntentClassifier({ run, modelId: "" });

    await expect(classifier.classify(baseInput(), neverAborts())).rejects.toBeInstanceOf(
      ConfigError,
    );
    expect(calls).toBe(0);
  });

  it("maps valid JSON enum to IntentResult", async () => {
    const run: WorkersAiRun = async () => ({
      response: JSON.stringify({
        intent: "list_hackathons",
        confidence: 0.91,
        slots: {},
      }),
    });
    const classifier = createWorkersAiIntentClassifier({ run, modelId: VALID_MODEL });

    await expect(classifier.classify(baseInput(), neverAborts())).resolves.toEqual({
      intent: "list_hackathons",
      confidence: 0.91,
      slots: {},
    });
  });

  it("maps invalid intent id and low confidence to unknown", async () => {
    const runBadIntent: WorkersAiRun = async () => ({
      response: JSON.stringify({ intent: "hack_the_planet", confidence: 0.99, slots: {} }),
    });
    const runLow: WorkersAiRun = async () => ({
      response: JSON.stringify({ intent: "help", confidence: 0.4, slots: {} }),
    });

    await expect(
      createWorkersAiIntentClassifier({ run: runBadIntent, modelId: VALID_MODEL }).classify(
        baseInput(),
        neverAborts(),
      ),
    ).resolves.toMatchObject({ intent: "unknown" });

    await expect(
      createWorkersAiIntentClassifier({ run: runLow, modelId: VALID_MODEL }).classify(
        baseInput(),
        neverAborts(),
      ),
    ).resolves.toMatchObject({ intent: "unknown" });
  });

  it("throws IntentClassificationError on bad JSON", async () => {
    const run: WorkersAiRun = async () => ({ response: "not-json-at-all" });
    const classifier = createWorkersAiIntentClassifier({ run, modelId: VALID_MODEL });

    await expect(classifier.classify(baseInput(), neverAborts())).rejects.toBeInstanceOf(
      IntentClassificationError,
    );
  });

  it("throws LlmQuotaExceededError when Workers AI reports quota exhaustion", async () => {
    const run: WorkersAiRun = async () => {
      throw new Error("Workers AI quota exceeded (429)");
    };
    const classifier = createWorkersAiIntentClassifier({ run, modelId: VALID_MODEL });

    await expect(classifier.classify(baseInput(), neverAborts())).rejects.toBeInstanceOf(
      LlmQuotaExceededError,
    );
  });

  it("never logs the utterance (no console side effects with user text)", async () => {
    const logs: unknown[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args);
    };
    try {
      const secret = "mi email es secret@example.com";
      const run: WorkersAiRun = async () => ({
        response: JSON.stringify({ intent: "help", confidence: 0.9, slots: {} }),
      });
      await createWorkersAiIntentClassifier({ run, modelId: VALID_MODEL }).classify(
        baseInput(secret),
        neverAborts(),
      );
      expect(JSON.stringify(logs)).not.toContain(secret);
    } finally {
      console.log = original;
    }
  });
});
