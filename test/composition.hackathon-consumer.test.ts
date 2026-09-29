import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stubTelegramApi } from "./support/telegram-stub";
import { buildHackathonConsumer } from "../src/composition";
import { BrowserQuotaExceededError } from "../src/domain/errors";
import type { Env } from "../src/env";
import { fakeChatPublisher } from "./fakes";

// task 9.5 (design.md "File Changes": `buildHackathonConsumer(env)` uses
// `new Api(BOT_TOKEN)` without `PII_KEYRING`, like `buildGithubRouter`).

const launchBrowser = async () => {
  throw new Error("not launched in this test");
};

function consumerEnv(overrides: Partial<Env> = {}): Env {
  const aiCalls: Array<{ model: string }> = [];
  return {
    ...(env as unknown as Env),
    AI: {
      run: async (model: string) => {
        aiCalls.push({ model });
        return { response: "{}" };
      },
    },
    BROWSER: { fake: "browser-binding" } as unknown as BrowserRun,
    HACKATHON_MODEL_PRIMARY: "@cf/vendor/primary",
    HACKATHON_MODEL_FALLBACK: "@cf/vendor/fallback",
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

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
  ])("still builds (blank model passed through) when %s is unset (R4-001)", (name, overrides) => {
    // The use case classifies the unset model as its own config failure, so
    // composition must not throw and short-circuit that terminal path.
    const deps = buildHackathonConsumer(consumerEnv(overrides), {
      chatPublisher: fakeChatPublisher(),
      launchBrowser,
    });

    expect(deps[name === "HACKATHON_MODEL_PRIMARY" ? "primaryModel" : "fallbackModel"]).toBe("");
  });

  // task 10.1/10.4 carry-over from PR9: with no injected adapters the
  // production defaults are the real Telegram publisher (new Api(BOT_TOKEN),
  // no Bot, no PII_KEYRING — mirrors buildGithubRouter) and the
  // @cloudflare/puppeteer launch.
  it("defaults to the real Telegram chat publisher built from BOT_TOKEN, without PII_KEYRING", async () => {
    const calls = stubTelegramApi((method) =>
      method === "sendMessage" ? { message_id: 321, date: 0, chat: { id: 555, type: "supergroup" } } : undefined,
    );
    const deps = buildHackathonConsumer(consumerEnv({ PII_KEYRING: "not-json-at-all" }));

    const messageId = await deps.chatPublisher.post(555, 42, "hello");

    expect(messageId).toBe(321);
    expect(calls.find((c) => c.method === "sendMessage")?.body).toMatchObject({
      chat_id: 555,
      text: "hello",
      message_thread_id: 42,
    });
  });

  it("defaults the browser launch to @cloudflare/puppeteer with the BROWSER binding", async () => {
    // The real package runs against a fake binding that answers the acquire
    // request with the documented daily-limit 429.
    const requests: string[] = [];
    const binding = {
      fetch: async (input: RequestInfo | URL) => {
        requests.push(String(input));
        return new Response("Browser time limit exceeded for today", { status: 429 });
      },
    };
    const deps = buildHackathonConsumer(consumerEnv({ BROWSER: binding as unknown as BrowserRun }));

    await expect(
      deps.renderedFetcher.fetch("https://example.com/event", new AbortController().signal),
    ).rejects.toBeInstanceOf(BrowserQuotaExceededError);

    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain("/v1/devtools/browser");
  });

  it("lets an injected adapter replace the default publisher", () => {
    const publisher = fakeChatPublisher();

    const deps = buildHackathonConsumer(consumerEnv(), { chatPublisher: publisher });

    expect(deps.chatPublisher).toBe(publisher);
  });
});
