import type { Api } from "grammy";
import { PublishFailedError } from "../../domain/errors";
import type { ChatPublisher, PostOptions } from "../../domain/ports";
import { nlConfirmButtons, participateButton } from "./copy";
import { classifyPublishFailure, classifyTelegramFailure } from "./send-failure";

// Callback data for the participation button: `hp:<slug>`. Slugs are capped
// at 40 chars, so it always fits Telegram's 64-byte limit. The team is never
// encoded: it is derived from the chat when the callback arrives.
export const PARTICIPATE_CALLBACK_PREFIX = "hp:";

// NL mutate confirmation buttons: `nl:ok:<uuid>` / `nl:no:<uuid>` (≤64 bytes).
export const NL_CONFIRM_OK_PREFIX = "nl:ok:";
export const NL_CONFIRM_NO_PREFIX = "nl:no:";
// NL disambiguation pick: `nl:p:<uuid>:<index>`.
export const NL_PICK_PREFIX = "nl:p:";

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

function truncateLabel(label: string, max = 40): string {
  const trimmed = label.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function replyMarkupFor(options: PostOptions | undefined):
  | { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> }
  | undefined {
  if (options?.nlConfirmId !== undefined) {
    const id = options.nlConfirmId;
    return {
      inline_keyboard: [
        [
          { text: nlConfirmButtons.confirm, callback_data: `${NL_CONFIRM_OK_PREFIX}${id}` },
          { text: nlConfirmButtons.cancel, callback_data: `${NL_CONFIRM_NO_PREFIX}${id}` },
        ],
      ],
    };
  }
  if (options?.nlPick !== undefined) {
    const { confirmId, labels } = options.nlPick;
    return {
      inline_keyboard: labels.slice(0, 8).map((label, index) => [
        {
          text: truncateLabel(label),
          callback_data: `${NL_PICK_PREFIX}${confirmId}:${index}`,
        },
      ]),
    };
  }
  if (options?.participateSlug !== undefined) {
    return {
      inline_keyboard: [
        [
          {
            text: participateButton,
            callback_data: `${PARTICIPATE_CALLBACK_PREFIX}${options.participateSlug}`,
          },
        ],
      ],
    };
  }
  return undefined;
}

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
        const markup = replyMarkupFor(options);
        const sent = await api.sendMessage(
          chatId,
          text,
          {
            // The general chat has no thread: the field is omitted rather
            // than sent as null, which Telegram would reject.
            ...(threadId !== null ? { message_thread_id: threadId } : {}),
            link_preview_options: { is_disabled: true },
            ...(markup !== undefined ? { reply_markup: markup } : {}),
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

    async editMessage(chatId, messageId, text, options) {
      try {
        const markup = replyMarkupFor(options);
        await api.editMessageText(
          chatId,
          messageId,
          text,
          {
            link_preview_options: { is_disabled: true },
            ...(markup !== undefined ? { reply_markup: markup } : {}),
          },
          publishSignal(),
        );
      } catch (err) {
        throw new PublishFailedError("editMessageText failed", classifyTelegramFailure(err));
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
