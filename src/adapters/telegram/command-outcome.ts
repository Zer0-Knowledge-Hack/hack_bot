import type { Logger } from "../../domain/ports";

// RES-001 webhook response policy, factored into one shared helper so it
// cannot drift per command again (it already drifted twice: /datachannel
// once shipped with an unlogged refusal branch, then with a recognized
// domain error — NotFoundError — silently falling through to the
// unrecognized-error/rethrow branch and turning a real TOCTOU refusal into
// a permanent 500 that Telegram retries forever).
//
// Only a RECOGNIZED domain error (one the command explicitly lists in its
// `errorReplies` map) is a user-facing refusal: log "refused", reply, and
// return normally (200 via the caller/top-level boundary). An
// UNRECOGNIZED error is an unexpected/transient infrastructure failure
// (e.g. D1) — log it (errorCode only, never the raw error/message) and
// rethrow so the single top-level boundary (src/index.ts) answers 500
// instead of silently swallowing it into a misleading 200 reply.

// Keyed by the `Error` subclass's `.name` (matches DomainError's
// `this.name = new.target.name` convention — see src/domain/errors.ts) so
// the map is a plain, inspectable Record instead of an `instanceof` chain.
// Using `error.name` as the key means a command's `errorReplies` map is a
// single flat object literal: adding a use case's new domain error to that
// object is the ONE place a command must touch, and a forgotten case is
// silent-safe (falls to the rethrow branch below) rather than
// silent-unsafe (falls to a generic swallowed-200 reply).
export type DomainErrorReplies = Record<string, string>;

export interface RunCommandOptions {
  event: string;
  logger: Logger;
  reply: (text: string) => Promise<unknown>;
  errorReplies: DomainErrorReplies;
}

export interface RunCommandOk {
  okReply: string;
  // Only known at the end of a successful action (e.g. a use case's
  // returned/created team id) — set here rather than on RunCommandOptions
  // so the "ok" log line can include it without the caller having to know
  // it before the action runs.
  teamId?: string;
}

// Runs one command's use-case call, guaranteeing every outcome is logged
// (ok and refused — ids/field names only, per design.md "Logging") and
// that the reply/log/rethrow shape below can never be skipped or
// reordered per command.
export async function runCommand(
  options: RunCommandOptions,
  action: () => Promise<RunCommandOk>,
): Promise<void> {
  try {
    const { okReply, teamId } = await action();
    options.logger.log({
      event: options.event,
      outcome: "ok",
      ...(teamId !== undefined ? { teamId } : {}),
    });
    await options.reply(okReply);
  } catch (err) {
    const errorCode = err instanceof Error ? err.name : "UnknownError";
    const recognizedReply = options.errorReplies[errorCode];
    if (recognizedReply !== undefined) {
      options.logger.log({ event: options.event, outcome: "refused", errorCode });
      await options.reply(recognizedReply);
      return;
    }
    options.logger.log({ event: options.event, outcome: "error", errorCode });
    throw err;
  }
}
