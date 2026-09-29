import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import worker, { createQueueHandler } from "../src/index";
import type { Env } from "../src/index";
import { ConfigError } from "../src/config-error";
import { PageFetchFailedError } from "../src/domain/errors";
import { asTeamId } from "../src/domain/ids";
import type { AnalysisJob, AnalysisJobMessage } from "../src/domain/entities";
import {
  TRANSIENT_RETRY_DELAY_S,
  type RunHackathonJobDeps,
} from "../src/domain/usecases/run-hackathon-job";
import {
  fakeAnalysisJobRepo,
  fakeAnalysisQuota,
  fakeChatPublisher,
  fakeClock,
  fakeHackathonAnalysisRepo,
  fakeIdGen,
  fakeLlmExtractor,
  fakeLogger,
  fakePageFetcher,
  fakeRepoTopicLinkRepo,
} from "./fakes";

// task 9.3 (design.md "Testing Strategy": "Consumer handler"): the handler
// is called directly with a fake batch and fake `Message`s — no live queue.

const teamId = asTeamId("team-1");

function validBody(overrides: Partial<AnalysisJobMessage> = {}): AnalysisJobMessage {
  return {
    v: 1,
    jobId: "job-1",
    teamId,
    chatId: 111,
    threadId: null,
    fetchUrl: "https://example.com/event",
    ...overrides,
  };
}

function baseJob(overrides: Partial<AnalysisJob> = {}): AnalysisJob {
  return {
    id: "job-1",
    teamId,
    chatId: 111,
    threadId: null,
    utcDay: "2024-01-01",
    fetchUrl: "https://example.com/event",
    status: "running",
    attempts: 1,
    claimUntil: 0,
    analysisId: null,
    failureReason: null,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

interface FakeMessage {
  body: unknown;
  attempts: number;
  acked: number;
  retries: Array<{ delaySeconds?: number } | undefined>;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
}

function fakeMessage(body: unknown, attempts = 1): FakeMessage {
  const m: FakeMessage = {
    body,
    attempts,
    acked: 0,
    retries: [],
    ack() {
      m.acked += 1;
    },
    retry(options) {
      m.retries.push(options);
    },
  };
  return m;
}

function makeDeps() {
  return {
    analysisJobRepo: fakeAnalysisJobRepo(),
    analysisQuota: fakeAnalysisQuota(),
    chatPublisher: fakeChatPublisher(),
    hackathonAnalysisRepo: fakeHackathonAnalysisRepo(),
    repoTopicLinkRepo: fakeRepoTopicLinkRepo(),
    staticFetcher: fakePageFetcher([{ text: "x".repeat(900) }]),
    renderedFetcher: fakePageFetcher([{ text: "" }]),
    llmExtractor: fakeLlmExtractor([{ raw: {} }]),
    clock: fakeClock(1_700_000_000_000),
    idGen: fakeIdGen(),
    logger: fakeLogger(),
    primaryModel: "@cf/primary",
    fallbackModel: "@cf/fallback",
  } satisfies RunHackathonJobDeps;
}

function handlerFor(deps: RunHackathonJobDeps, logger = fakeLogger()) {
  let builds = 0;
  const handler = createQueueHandler(() => {
    builds += 1;
    return deps;
  }, logger);
  return { handler, logger, builds: () => builds };
}

const testEnv = env as unknown as Env;

describe("queue handler: message validation", () => {
  it.each([
    ["a string body", "not-an-object"],
    ["a null body", null],
    ["an array body", []],
    ["a missing jobId", { ...validBody(), jobId: undefined }],
    ["a non-string jobId", { ...validBody(), jobId: 5 }],
    ["an empty jobId", { ...validBody(), jobId: "" }],
    ["a non-numeric chatId", { ...validBody(), chatId: "111" }],
    ["a non-null non-numeric threadId", { ...validBody(), threadId: "7" }],
    ["a missing fetchUrl", { ...validBody(), fetchUrl: undefined }],
  ])("acks and logs a malformed body (%s) without building deps", async (_n, body) => {
    const deps = makeDeps();
    const { handler, logger, builds } = handlerFor(deps);
    const msg = fakeMessage(body);

    await handler({ messages: [msg] }, testEnv);

    expect(msg.acked).toBe(1);
    expect(msg.retries).toHaveLength(0);
    expect(builds()).toBe(0);
    expect(logger.entries).toEqual([
      { event: "hackathon-consumer", outcome: "error", reason: "malformed-message" },
    ]);
  });

  it("acks and logs a message from an unknown version", async () => {
    const deps = makeDeps();
    const { handler, logger, builds } = handlerFor(deps);
    const msg = fakeMessage({ ...validBody(), v: 2 });

    await handler({ messages: [msg] }, testEnv);

    expect(msg.acked).toBe(1);
    expect(msg.retries).toHaveLength(0);
    expect(builds()).toBe(0);
    expect(logger.entries).toEqual([
      { event: "hackathon-consumer", outcome: "error", reason: "unsupported-version" },
    ]);
  });

  it("never logs the content of a malformed message", async () => {
    const { handler, logger } = handlerFor(makeDeps());
    const msg = fakeMessage({ jobId: "secret-job", fetchUrl: "https://secret.example/x" });

    await handler({ messages: [msg] }, testEnv);

    expect(msg.acked).toBe(1);
    expect(logger.entries).toHaveLength(1);
    expect(JSON.stringify(logger.entries)).not.toContain("secret");
  });
});

describe("queue handler: outcome mapping", () => {
  it("acks a duplicate delivery of a terminal job with no side effects", async () => {
    const deps = makeDeps();
    deps.analysisJobRepo = fakeAnalysisJobRepo({ claimResult: { kind: "terminal" } });
    const { handler } = handlerFor(deps);
    const msg = fakeMessage(validBody());

    await handler({ messages: [msg] }, testEnv);

    expect(msg.acked).toBe(1);
    expect(msg.retries).toHaveLength(0);
    expect(deps.staticFetcher.calls).toHaveLength(0);
    expect(deps.chatPublisher.posted).toHaveLength(0);
  });

  it("retries a held claim with the use case delaySeconds", async () => {
    const deps = makeDeps();
    deps.analysisJobRepo = fakeAnalysisJobRepo({ claimResult: { kind: "held" } });
    const { handler } = handlerFor(deps);
    const msg = fakeMessage(validBody());

    await handler({ messages: [msg] }, testEnv);

    expect(msg.acked).toBe(0);
    expect(msg.retries).toEqual([{ delaySeconds: 60 }]);
  });

  it("retries a transient failure with a 30 s delay before the last attempt", async () => {
    const deps = makeDeps();
    deps.analysisJobRepo = fakeAnalysisJobRepo({
      claimResult: { kind: "claimed", job: baseJob() },
    });
    deps.staticFetcher = fakePageFetcher([{ throws: new Error("network glitch") }]);
    const { handler } = handlerFor(deps);
    const msg = fakeMessage(validBody(), 1);

    await handler({ messages: [msg] }, testEnv);

    expect(msg.retries).toEqual([{ delaySeconds: 30 }]);
    expect(msg.acked).toBe(0);
  });

  it("passes the queue delivery attempt so the last attempt fails and acks", async () => {
    const deps = makeDeps();
    deps.analysisJobRepo = fakeAnalysisJobRepo({
      claimResult: { kind: "claimed", job: baseJob() },
    });
    deps.staticFetcher = fakePageFetcher([{ throws: new Error("network glitch") }]);
    const { handler } = handlerFor(deps);
    const msg = fakeMessage(validBody(), 3);

    await handler({ messages: [msg] }, testEnv);

    expect(msg.acked).toBe(1);
    expect(msg.retries).toHaveLength(0);
    expect(deps.analysisJobRepo.failed).toEqual([
      { id: "job-1", reason: "job:transient:Error" },
    ]);
  });

  it("acks a permanent failure after replying", async () => {
    const deps = makeDeps();
    deps.analysisJobRepo = fakeAnalysisJobRepo({
      claimResult: { kind: "claimed", job: baseJob() },
    });
    deps.staticFetcher = fakePageFetcher([
      { throws: new PageFetchFailedError("gone", "http-status") },
    ]);
    const { handler } = handlerFor(deps);
    const msg = fakeMessage(validBody());

    await handler({ messages: [msg] }, testEnv);

    expect(msg.acked).toBe(1);
    expect(deps.chatPublisher.posted).toHaveLength(1);
  });
});

describe("queue handler: never throws", () => {
  // R2-001: the unexpected-failure delay and the use case's transient delay
  // are one exported constant, so the two retry cadences cannot drift apart.
  it("retries an unexpected failure with the use case's transient retry delay", async () => {
    const deps = makeDeps();
    deps.analysisJobRepo = {
      ...fakeAnalysisJobRepo(),
      claim: async () => {
        throw new TypeError("boom");
      },
    };
    const { handler } = handlerFor(deps);
    const msg = fakeMessage(validBody());

    await handler({ messages: [msg] }, testEnv);

    expect(TRANSIENT_RETRY_DELAY_S).toBe(30);
    expect(msg.retries).toEqual([{ delaySeconds: TRANSIENT_RETRY_DELAY_S }]);
  });

  it("retries with a delay and logs only the error name when the use case throws", async () => {
    const deps = makeDeps();
    deps.analysisJobRepo = {
      ...fakeAnalysisJobRepo(),
      claim: async () => {
        throw new TypeError("D1 exploded with secret detail");
      },
    };
    const { handler, logger } = handlerFor(deps);
    const msg = fakeMessage(validBody());

    await expect(handler({ messages: [msg] }, testEnv)).resolves.toBeUndefined();

    expect(msg.retries).toEqual([{ delaySeconds: 30 }]);
    expect(msg.acked).toBe(0);
    expect(logger.entries).toEqual([
      { event: "hackathon-consumer", teamId, outcome: "error", errorCode: "TypeError" },
    ]);
  });

  it("retries every message with the ConfigError reason when composition fails", async () => {
    const logger = fakeLogger();
    const handler = createQueueHandler(() => {
      throw new ConfigError("BOT_TOKEN is not configured");
    }, logger);
    const a = fakeMessage(validBody({ jobId: "a" }));
    const b = fakeMessage(validBody({ jobId: "b" }));

    await expect(handler({ messages: [a, b] }, testEnv)).resolves.toBeUndefined();

    expect(a.retries).toEqual([{ delaySeconds: 30 }]);
    expect(b.retries).toEqual([{ delaySeconds: 30 }]);
    expect(logger.entries).toHaveLength(2);
    expect(logger.entries[0]).toMatchObject({
      event: "hackathon-consumer",
      outcome: "error",
      errorCode: "ConfigError",
      reason: "BOT_TOKEN is not configured",
    });
  });

  it("handles each message of a batch independently", async () => {
    const deps = makeDeps();
    deps.analysisJobRepo = fakeAnalysisJobRepo({ claimResult: { kind: "terminal" } });
    const { handler } = handlerFor(deps);
    const bad = fakeMessage("junk");
    const good = fakeMessage(validBody());

    await handler({ messages: [bad, good] }, testEnv);

    expect(bad.acked).toBe(1);
    expect(good.acked).toBe(1);
  });
});

describe("default export", () => {
  it("exposes both fetch and queue handlers", () => {
    expect(typeof worker.fetch).toBe("function");
    expect(typeof worker.queue).toBe("function");
  });

  // PR10: the production handler is fully wired (real Telegram publisher and
  // puppeteer launch built from the env), so a configured env no longer fails
  // closed with a ConfigError. The job row is unknown, so the real D1 claim
  // says "missing" and the message is acked (a completed no-op).
  it("runs a valid message through the fully wired production handler without a ConfigError", async () => {
    const logs: string[] = [];
    const consoleSpy = vi.spyOn(console, "log").mockImplementation((line) => {
      logs.push(String(line));
    });
    const msg = fakeMessage(validBody({ jobId: "job-unknown-to-d1" }));

    await worker.queue(
      { messages: [msg] } as never,
      {
        ...env,
        HACKATHON_MODEL_PRIMARY: "@cf/vendor/primary",
        HACKATHON_MODEL_FALLBACK: "@cf/vendor/fallback",
      } as unknown as Env,
    );
    consoleSpy.mockRestore();

    expect(msg.retries).toEqual([]);
    expect(msg.acked).toBe(1);
    expect(logs.join("\n")).not.toContain("ConfigError");
  });

  it("acks a malformed message through the real default queue handler", async () => {
    const msg = fakeMessage({ nope: true });

    await worker.queue({ messages: [msg] } as never, testEnv);

    expect(msg.acked).toBe(1);
  });
});
