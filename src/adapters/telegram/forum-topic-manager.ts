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

export function createTelegramForumTopicManager(api: Api): ForumTopicManager {
  return {
    async create(chatId, name) {
      try {
        const topic = await api.createForumTopic(chatId, name, undefined, topicSignal());
        return topic.message_thread_id;
      } catch (err) {
        // Fixed message: Telegram's description is never carried over.
        throw new ForumTopicCreateError("createForumTopic failed", classifyCreateFailure(err));
      }
    },
  };
}
