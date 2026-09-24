import { Hono } from "hono";
import type { Update } from "grammy/types";
import { createSafeLogger } from "./adapters/log/safe-logger";
import { verifyGithubSignature } from "./adapters/github/signature";
import { timingSafeCompare } from "./adapters/crypto/timing-safe-compare";
import { buildBot } from "./composition";
import { ConfigError } from "./config-error";
import type { Env } from "./env";

export type { Env } from "./env";

const app = new Hono<{ Bindings: Env }>();
const logger = createSafeLogger();

app.get("/health", (c) => c.json({ status: "ok" }));

app.post("/telegram/webhook", async (c) => {
  const provided = c.req.header("X-Telegram-Bot-Api-Secret-Token");
  // design.md "Webhook auth": constant-time comparison, length checked
  // first, before the body is ever parsed (READ-001: shared with the
  // GitHub route's signature check via timingSafeCompare).
  if (!provided || !timingSafeCompare(provided, c.env.WEBHOOK_SECRET)) {
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

// design.md "GitHub route status policy" — route skeleton only (PR3). The
// mapper, org/repo routing and Telegram delivery land in Phase 4; until
// then every signature-verified, well-formed, non-ping event is
// acknowledged and dropped (the same 2xx the design table gives an
// unsupported event/action, since nothing is wired to support one yet).
app.post("/github/webhook", async (c) => {
  // RES-001, corrected: an unreadable raw body is a transient, transport-
  // level failure (e.g. a broken/aborted request stream) on a request that
  // was never authenticated — it is NOT the "redelivering the same bytes
  // can never succeed" case (that rationale applies to malformed content
  // that WAS fully read, like the JSON.parse/non-object branches below).
  // design.md's status policy treats transient/unexpected failures as 500,
  // so the delivery shows as failed in GitHub and can be redelivered.
  let rawBody: ArrayBuffer;
  try {
    rawBody = await c.req.arrayBuffer();
  } catch (err) {
    logger.log({
      event: "github-webhook",
      outcome: "error",
      errorCode: err instanceof Error ? err.name : "UnknownError",
    });
    return c.text("Internal Server Error", 500);
  }
  const signatureHeader = c.req.header("X-Hub-Signature-256");

  let verified: boolean;
  try {
    verified = await verifyGithubSignature(rawBody, signatureHeader, c.env.GITHUB_WEBHOOK_SECRET);
  } catch (err) {
    // GITHUB_WEBHOOK_SECRET unset/empty (design.md: 500, logged as a
    // ConfigError reason — never a silent accept, never a crash).
    logger.log({
      event: "github-webhook",
      outcome: "error",
      errorCode: err instanceof Error ? err.name : "UnknownError",
      ...(err instanceof ConfigError ? { reason: err.message } : {}),
    });
    return c.text("Internal Server Error", 500);
  }
  if (!verified) {
    return c.text("Unauthorized", 401);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(rawBody));
  } catch (err) {
    logger.log({
      event: "github-webhook",
      outcome: "error",
      errorCode: err instanceof Error ? err.name : "UnknownError",
    });
    return c.text("ok", 200);
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    logger.log({ event: "github-webhook", outcome: "error", errorCode: "MalformedPayload" });
    return c.text("ok", 200);
  }

  if (c.req.header("X-GitHub-Event") === "ping") {
    return c.text("ok", 200);
  }

  // Placeholder until Phase 4 wires the mapper/router: acknowledge, drop,
  // and log (RES-002 / design.md:27 "unsupported event or action: 200,
  // logged"). `reason` is a fixed, non-sensitive string per the logging
  // allowlist — never the event type, action, or any payload field.
  logger.log({ event: "github-webhook", outcome: "ok", reason: "ignored:not-yet-routed" });
  return c.text("ok", 200);
});

export default app;
