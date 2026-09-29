import type { Api } from "grammy";
import { PublishFailedError } from "../../domain/errors";
import type { ChatPublisher } from "../../domain/ports";
import { participateButton } from "./copy";
import { classifyPublishFailure, classifyTelegramFailure } from "./send-failure";

// Callback data for the participation button: `hp:<slug>`. Slugs are capped
// at 40 chars, so it always fits Telegram's 64-byte limit. The team is never
// encoded: it is derived from the chat when the callback arrives.
export const PARTICIPATE_CALLBACK_PREFIX = "hp:";

// design.md "Time budget": Telegram publish 10 s. grammY has no default
// timeout, so each call carries its own abort signal; a timeout surfaces as
// an HttpError and is classified `telegram-unavailable` (transient).
const PUBLISH_TIMEOUT_MS = 10_000;

// grammY types its `signal` parameter with the abort-controller shim's
// AbortSignal, which is not assignable from the runtime's global one; both
// are the same object at runtime.
type GrammySignal = Parameters<Api["getMe"]>[0];
const publishSignal = (): GrammySignal =>
  AbortSignal.timeout(PUBLISH_TIMEOUT_MS) as unknown as GrammySignal;

// design.md "Sender": `new Api(BOT_TOKEN)` in composition, no `Bot` and no
// `PII_KEYRING`. Plain text (no `parse_mode`) — spec hackathon-analysis
// "Plain Text Replies" — so page-derived text can never break sending via
// MarkdownV2/HTML escaping. Every failure becomes a `PublishFailedError`
// with a fixed message: Telegram's `description` (which can echo
// operator-specific detail), the chat id and the token are never carried
// over. Mirrors `createTelegramAlertSender`.
export function createTelegramChatPublisher(api: Api): ChatPublisher {
  return {
    async post(chatId, threadId, text, options) {
      try {
        const sent = await api.sendMessage(
          chatId,
          text,
          {
            // The general chat has no thread: the field is omitted rather
            // than sent as null, which Telegram would reject.
            ...(threadId !== null ? { message_thread_id: threadId } : {}),
            link_preview_options: { is_disabled: true },
            ...(options?.participateSlug !== undefined
              ? {
                  reply_markup: {
                    inline_keyboard: [
                      [
                        {
                          text: participateButton,
                          callback_data: `${PARTICIPATE_CALLBACK_PREFIX}${options.participateSlug}`,
                        },
                      ],
                    ],
                  },
                }
              : {}),
          },
          publishSignal(),
        );
        return sent.message_id;
      } catch (err) {
        throw new PublishFailedError("sendMessage failed", classifyPublishFailure(err));
      }
    },

    async pin(chatId, messageId) {
      try {
        await api.pinChatMessage(
          chatId,
          messageId,
          { disable_notification: true },
          publishSignal(),
        );
      } catch (err) {
        throw new PublishFailedError("pinChatMessage failed", classifyTelegramFailure(err));
      }
    },

    // Omitting `reply_markup` from editMessageReplyMarkup removes the keyboard.
    async clearButtons(chatId, messageId) {
      try {
        await api.editMessageReplyMarkup(chatId, messageId, undefined, publishSignal());
      } catch (err) {
        throw new PublishFailedError("editMessageReplyMarkup failed", classifyTelegramFailure(err));
      }
    },

    async unpin(chatId, messageId) {
      try {
        await api.unpinChatMessage(chatId, messageId, undefined, publishSignal());
      } catch (err) {
        throw new PublishFailedError("unpinChatMessage failed", classifyTelegramFailure(err));
      }
    },
  };
}
