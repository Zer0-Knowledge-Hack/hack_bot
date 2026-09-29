import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { buildHackathonConsumer } from "../src/composition";
import { ConfigError } from "../src/config-error";
import type { HackathonConsumerEnv } from "../src/env";
import { fakeChatPublisher } from "./fakes";

// task 9.5 (design.md "File Changes": `buildHackathonConsumer(env)` uses
// `new Api(BOT_TOKEN)` without `PII_KEYRING`, like `buildGithubRouter`).

const launchBrowser = async () => {
  throw new Error("not launched in this test");
};

function consumerEnv(overrides: Partial<HackathonConsumerEnv> = {}): HackathonConsumerEnv {
  const aiCalls: Array<{ model: string }> = [];
  return {
    ...(env as unknown as HackathonConsumerEnv),
    AI: {
      run: async (model: string) => {
        aiCalls.push({ model });
        return { response: "{}" };
      },
    },
    BROWSER: { fake: "browser-binding" },
    HACKATHON_MODEL_PRIMARY: "@cf/vendor/primary",
    HACKATHON_MODEL_FALLBACK: "@cf/vendor/fallback",
    ...overrides,
  };
}

describe("buildHackathonConsumer", () => {
  it("wires the models from vars and every port the job needs", () => {
    const publisher = fakeChatPublisher();

    const deps = buildHackathonConsumer(consumerEnv(), {
      chatPublisher: publisher,
      launchBrowser,
    });

    expect(deps.primaryModel).toBe("@cf/vendor/primary");
    expect(deps.fallbackModel).toBe("@cf/vendor/fallback");
    expect(deps.chatPublisher).toBe(publisher);
    for (const port of [
      "analysisJobRepo",
      "analysisQuota",
      "hackathonAnalysisRepo",
      "repoTopicLinkRepo",
      "staticFetcher",
      "renderedFetcher",
      "llmExtractor",
      "logger",
    ] as const) {
      expect(typeof deps[port]).toBe("object");
    }
  });

  it("does not need PII_KEYRING (a broken keyring must not break the consumer)", () => {
    const deps = buildHackathonConsumer(
      consumerEnv({ PII_KEYRING: "not-json-at-all" }),
      { chatPublisher: fakeChatPublisher(), launchBrowser },
    );

    expect(deps.primaryModel).toBe("@cf/vendor/primary");
  });

  it("routes the extractor through the AI binding", async () => {
    const calls: string[] = [];
    const deps = buildHackathonConsumer(
      consumerEnv({
        AI: {
          run: async (model: string) => {
            calls.push(model);
            return { response: "{}" };
          },
        },
      }),
      { chatPublisher: fakeChatPublisher(), launchBrowser },
    );

    await deps.llmExtractor.extract("page text", "@cf/vendor/primary", new AbortController().signal);

    expect(calls).toEqual(["@cf/vendor/primary"]);
  });

  it.each([
    ["HACKATHON_MODEL_PRIMARY", { HACKATHON_MODEL_PRIMARY: "" }],
    ["HACKATHON_MODEL_FALLBACK", { HACKATHON_MODEL_FALLBACK: "  " }],
  ])("fails closed with a ConfigError when %s is unset", (_name, overrides) => {
    expect(() =>
      buildHackathonConsumer(consumerEnv(overrides), {
        chatPublisher: fakeChatPublisher(),
        launchBrowser,
      }),
    ).toThrow(ConfigError);
  });

  it("fails closed with a ConfigError when the publisher and browser are not wired", () => {
    expect(() => buildHackathonConsumer(consumerEnv())).toThrow(ConfigError);
  });
});
