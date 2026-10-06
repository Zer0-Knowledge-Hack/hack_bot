import { GrammyError } from "grammy";
import type { Api } from "grammy";
import { ForumTopicCreateError } from "../../domain/errors";
import type { ForumTopicManager, TopicCreateFailure } from "../../domain/ports";

// Same 10 s Telegram budget as the chat publisher; a timeout surfaces as a
// non-Grammy error and is classified `unavailable` (the topic may exist).
const TOPIC_TIMEOUT_MS = 10_000;

// grammY types its `signal` parameter with the abort-controller shim's
// AbortSignal; both are the same object at runtime (see chat-publisher.ts).
type GrammySignal = Parameters<Api["getMe"]>[0];
const topicSignal = (): GrammySignal =>
  AbortSignal.timeout(TOPIC_TIMEOUT_MS) as unknown as GrammySignal;

const NO_RIGHTS = /not enough rights|chat_admin_required/i;
const NOT_FORUM = /not a forum|channel_forum_missing/i;

function classifyCreateFailure(err: unknown): TopicCreateFailure {
  if (!(err instanceof GrammyError)) return "unavailable";
  if (NO_RIGHTS.test(err.description)) return "no-rights";
  if (NOT_FORUM.test(err.description)) return "not-forum";
  if (err.error_code === 429) return "rate-limited";
  if (err.error_code >= 500) return "unavailable";
  return "rejected";
}

const VARIATION_SELECTOR = /️/gu;
const normalizeEmoji = (emoji: string): string => emoji.replace(VARIATION_SELECTOR, "");

type IconStickers = Awaited<ReturnType<Api["getForumTopicIconStickers"]>>;

// Per-isolate cache of Telegram's topic icon set. A rejection clears it so a
// transient failure is retried instead of cached forever.
let iconStickers: Promise<IconStickers> | null = null;

export function resetTopicIconCache(): void {
  iconStickers = null;
}

function loadIconStickers(api: Api): Promise<IconStickers> {
  if (!iconStickers) {
    const pending = api.getForumTopicIconStickers(topicSignal());
    iconStickers = pending;
    pending.catch(() => {
      if (iconStickers === pending) iconStickers = null;
    });
  }
  return iconStickers;
}

// Best-effort: any failure (or no match) means "no icon", never a failed create.
async function findIconId(api: Api, emoji: string): Promise<string | null> {
  try {
    const stickers = await loadIconStickers(api);
    if (!Array.isArray(stickers)) return null;
    const wanted = normalizeEmoji(emoji);
    const hit = stickers.find((s) => s.emoji !== undefined && normalizeEmoji(s.emoji) === wanted);
    return hit?.custom_emoji_id ?? null;
  } catch {
    return null;
  }
}

export function createTelegramForumTopicManager(api: Api): ForumTopicManager {
  return {
    async create(chatId, name, options) {
      const iconId = options ? await findIconId(api, options.iconEmoji) : null;
      const finalName = options && iconId === null ? options.fallbackName : name;
      try {
        const topic = await api.createForumTopic(
          chatId,
          finalName,
          iconId === null ? undefined : { icon_custom_emoji_id: iconId },
          topicSignal(),
        );
        return topic.message_thread_id;
      } catch (err) {
        // Fixed message: Telegram's description is never carried over.
        throw new ForumTopicCreateError("createForumTopic failed", classifyCreateFailure(err));
      }
    },

    async close(chatId, threadId) {
      try {
        await api.closeForumTopic(chatId, threadId, topicSignal());
      } catch (err) {
        throw new ForumTopicCreateError("closeForumTopic failed", classifyCreateFailure(err));
      }
    },

    async reopen(chatId, threadId) {
      try {
        await api.reopenForumTopic(chatId, threadId, topicSignal());
      } catch (err) {
        throw new ForumTopicCreateError("reopenForumTopic failed", classifyCreateFailure(err));
      }
    },
  };
}
