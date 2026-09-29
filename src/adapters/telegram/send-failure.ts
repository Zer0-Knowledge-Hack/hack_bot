import { GrammyError, HttpError } from "grammy";
import type { AlertSendFailureClass, PublishFailureClass } from "../../domain/errors";

// Classifies a failed Telegram Bot API call into a fixed, non-sensitive
// bucket a caller can safely log or branch on. `GrammyError` is Telegram's
// own JSON-encoded `{ok:false, error_code, description}` response (a
// genuine API-level rejection); anything else (a non-JSON/5xx response, or
// the fetch call itself failing) surfaces as grammY's `HttpError` and is
// treated as "telegram-unavailable" — the same bucket used for a
// Telegram-side 5xx. Shared by the GitHub alert sender and the hackathon
// chat publisher so the two cannot drift.
export function classifyTelegramFailure(err: unknown): AlertSendFailureClass {
  if (err instanceof GrammyError) {
    if (err.error_code === 429) return "rate-limited";
    if (err.error_code >= 500) return "telegram-unavailable";
    return "rejected";
  }
  if (err instanceof HttpError) return "telegram-unavailable";
  return "telegram-unavailable";
}

// Telegram's wording when a forum thread no longer exists.
const THREAD_GONE_DESCRIPTION = /message thread not found|topic_id_invalid|topic_deleted/i;

// Like `classifyTelegramFailure`, plus "thread-gone": a 400 whose description
// says the forum thread does not exist. Every other 4xx (a closed topic, no
// rights, ...) stays "rejected", because a LIVE topic can return those too.
// Description matching stays here; the domain only sees the class.
export function classifyPublishFailure(err: unknown): PublishFailureClass {
  if (err instanceof GrammyError && err.error_code === 400 && THREAD_GONE_DESCRIPTION.test(err.description)) {
    return "thread-gone";
  }
  return classifyTelegramFailure(err);
}
