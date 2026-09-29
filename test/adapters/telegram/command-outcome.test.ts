import { describe, expect, it } from "vitest";
import { runCommand } from "../../../src/adapters/telegram/command-outcome";
import { UnsafeUrlError } from "../../../src/domain/errors";
import { fakeLogger } from "../../fakes";

// task 10.3 (design.md "File Changes": `command-outcome.ts` — `reason`
// passthrough): a recognized refusal may carry a fixed, non-sensitive log
// `reason` next to its `errorCode`.

function setup(errorReasons?: Parameters<typeof runCommand>[0]["errorReasons"]) {
  const logger = fakeLogger();
  const replies: string[] = [];
  const options = {
    event: "hackathon-request",
    logger,
    reply: async (text: string) => {
      replies.push(text);
    },
    errorReplies: { UnsafeUrlError: "Only public http(s) pages can be analyzed.", QueueSendFailedError: "try again" },
    ...(errorReasons ? { errorReasons } : {}),
  };
  return { logger, replies, options };
}

describe("runCommand — refusal reason passthrough", () => {
  it("logs a static reason declared for the recognized error", async () => {
    const { logger, replies, options } = setup({ QueueSendFailedError: "queue:send-failed" });

    await runCommand(options, async () => {
      const err = new Error("boom");
      err.name = "QueueSendFailedError";
      throw err;
    });

    expect(replies).toEqual(["try again"]);
    expect(logger.entries).toEqual([
      { event: "hackathon-request", outcome: "refused", errorCode: "QueueSendFailedError", reason: "queue:send-failed" },
    ]);
  });

  it("derives the reason from the error when the declared reason is a function", async () => {
    const { logger, options } = setup({
      UnsafeUrlError: (err) => `unsafe-url:${(err as UnsafeUrlError).reason}`,
    });

    await runCommand(options, async () => {
      throw new UnsafeUrlError("unsafe", "ip-literal");
    });

    expect(logger.entries).toEqual([
      { event: "hackathon-request", outcome: "refused", errorCode: "UnsafeUrlError", reason: "unsafe-url:ip-literal" },
    ]);
  });

  it("omits reason when none is declared, exactly as before", async () => {
    const { logger, options } = setup();

    await runCommand(options, async () => {
      throw new UnsafeUrlError("unsafe", "scheme");
    });

    expect(logger.entries).toEqual([
      { event: "hackathon-request", outcome: "refused", errorCode: "UnsafeUrlError" },
    ]);
  });
});
