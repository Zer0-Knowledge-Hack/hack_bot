import { describe, expect, it } from "vitest";
import { createQueueAnalysisJobQueue } from "../../../src/adapters/queue/analysis-job-queue";
import { QueueSendFailedError } from "../../../src/domain/errors";
import type { AnalysisJobMessage } from "../../../src/domain/entities";
import type { TeamId } from "../../../src/domain/ids";

// task 9.1 (design.md "Error Taxonomy": `queue:send-failed`; "Adapters":
// injected `send`). No real Queue binding is used.

function message(overrides: Partial<AnalysisJobMessage> = {}): AnalysisJobMessage {
  return {
    v: 1,
    jobId: "job-1",
    teamId: "team-1" as TeamId,
    chatId: -100123,
    threadId: null,
    fetchUrl: "https://example.com/hack",
    ...overrides,
  };
}

describe("createQueueAnalysisJobQueue", () => {
  it("sends the exact message through the injected send", async () => {
    const sent: AnalysisJobMessage[] = [];
    const queue = createQueueAnalysisJobQueue({
      send: async (m) => {
        sent.push(m);
      },
    });

    await queue.enqueue(message({ jobId: "job-2", threadId: 7 }));

    expect(sent).toEqual([message({ jobId: "job-2", threadId: 7 })]);
  });

  it("maps a rejected send to QueueSendFailedError", async () => {
    const queue = createQueueAnalysisJobQueue({
      send: async () => {
        throw new Error("Queue is overloaded");
      },
    });

    await expect(queue.enqueue(message())).rejects.toBeInstanceOf(QueueSendFailedError);
  });

  it("never carries the underlying error text into the mapped error", async () => {
    const queue = createQueueAnalysisJobQueue({
      send: async () => {
        throw new Error("secret-detail https://example.com/hack");
      },
    });

    const err = await queue.enqueue(message()).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(QueueSendFailedError);
    expect((err as Error).message).toBe("Queue.send failed");
  });

  it("maps a synchronous throw from send the same way", async () => {
    const queue = createQueueAnalysisJobQueue({
      send: () => {
        throw new TypeError("bad binding");
      },
    });

    await expect(queue.enqueue(message())).rejects.toBeInstanceOf(QueueSendFailedError);
  });
});
