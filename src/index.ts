import { Hono } from "hono";
import type { Update } from "grammy/types";
import { createSafeLogger } from "./adapters/log/safe-logger";
import { buildBot } from "./composition";
import { ConfigError } from "./config-error";
import type { Env } from "./env";

export type { Env } from "./env";

const app = new Hono<{ Bindings: Env }>();
const logger = createSafeLogger();

app.get("/health", (c) => c.json({ status: "ok" }));

// design.md "Webhook auth": constant-time comparison, length checked
// first, before the body is ever parsed.
function isValidSecret(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const providedBytes = new TextEncoder().encode(provided);
  const expectedBytes = new TextEncoder().encode(expected);
  if (providedBytes.byteLength !== expectedBytes.byteLength) return false;
  return crypto.subtle.timingSafeEqual(providedBytes, expectedBytes);
}

app.post("/telegram/webhook", async (c) => {
  const provided = c.req.header("X-Telegram-Bot-Api-Secret-Token");
  if (!isValidSecret(provided, c.env.WEBHOOK_SECRET)) {
    return c.text("Unauthorized", 401);
  }

  let bot: ReturnType<typeof buildBot>;
  try {
    bot = buildBot(c.env);
  } catch (err) {
    // Fail closed on a broken PII_KEYRING (or any other composition
    // failure) — never log the secret. Only a ConfigError's message is
    // logged (as `reason`), because it is a fixed, non-sensitive string by
    // contract (src/config-error.ts); any other error's message may echo
    // input, so only its name is logged.
    logger.log({
      event: "composition",
      outcome: "error",
      errorCode: err instanceof Error ? err.name : "UnknownError",
      ...(err instanceof ConfigError ? { reason: err.message } : {}),
    });
    return c.text("Internal Server Error", 500);
  }

  // Webhook response policy (RES-001 / RES-002 — single error boundary for
  // the whole route):
  // - Handled user-facing errors (not admin, already exists, unauthorized,
  //   not a member, etc.) are caught INSIDE each command handler
  //   (commands.ts), which replies to the user and lets this function
  //   return the normal 200 below — the update was processed, redelivery
  //   adds nothing.
  // - An unparseable/malformed request body can never be fixed by Telegram
  //   redelivering the exact same bytes, so it is logged and answered 200.
  // - Anything else that escapes a command handler (a rethrown unexpected
  //   error — see commands.ts) is treated as an unexpected/transient
  //   infrastructure failure (e.g. D1). It is logged and answered 500 so
  //   Telegram's own retry acts as recovery. Never reply with internal
  //   error details to the user.
  let update: unknown;
  try {
    update = await c.req.json();
  } catch (err) {
    logger.log({
      event: "webhook",
      outcome: "error",
      errorCode: err instanceof Error ? err.name : "UnknownError",
    });
    return c.text("ok", 200);
  }
  // Valid JSON that is not an object (e.g. `null`) makes grammY throw a
  // TypeError, which would otherwise be answered 500 and retried forever.
  if (typeof update !== "object" || update === null || Array.isArray(update)) {
    logger.log({ event: "webhook", outcome: "error", errorCode: "MalformedUpdate" });
    return c.text("ok", 200);
  }

  try {
    await bot.handleUpdate(update as Update);
  } catch (err) {
    logger.log({
      event: "webhook",
      outcome: "error",
      errorCode: err instanceof Error ? err.name : "UnknownError",
    });
    return c.text("Internal Server Error", 500);
  }
  return c.text("ok");
});

export default app;
