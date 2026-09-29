import type { Api } from "grammy";
import { AlertSendFailedError } from "../../domain/errors";
import type { AlertSender } from "../../domain/ports";
import { classifyTelegramFailure } from "./send-failure";

// design.md "Sender": `new Api(BOT_TOKEN)` in composition, no `Bot` and no
// `PII_KEYRING` on this route. Plain text (no `parse_mode`) so a title with
// special characters cannot break sending via a MarkdownV2/HTML escaping
// bug (design.md "Message"). `link_preview_options.is_disabled` keeps the
// alert compact — a PR/issue URL preview adds nothing here.

// A failed send (e.g. the linked topic was deleted, a rate limit, or
// Telegram being unavailable) is a permanent-for-this-request delivery
// failure GitHub does not need to redeliver, so it is converted to
// AlertSendFailedError rather than propagated as-is — the port contract
// (ports.ts) requires this so routeGithubEvent can report "send-failed"
// instead of a 500 (design.md "GitHub route status policy"). The thrown
// error's message is always a fixed, non-sensitive string — Telegram's
// `description` (which can echo operator-specific detail) is never
// carried over, and neither is the chat id or the token.
export function createTelegramAlertSender(api: Api): AlertSender {
  return {
    async send(chatId: number, threadId: number, text: string): Promise<void> {
      try {
        await api.sendMessage(chatId, text, {
          message_thread_id: threadId,
          link_preview_options: { is_disabled: true },
        });
      } catch (err) {
        throw new AlertSendFailedError("sendMessage failed", classifyTelegramFailure(err));
      }
    },
  };
}
