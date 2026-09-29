import { GrammyError } from "grammy";
import type { Api } from "grammy";
import { ForumTopicCreateError } from "../../domain/errors";
import type { ForumTopicManager, TopicCreateFailure, TopicProbe } from "../../domain/ports";

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
// Telegram does not document these strings (design.md decision 2): they come
// from community reports and are validated by the operator smoke test.
const THREAD_GONE = /message thread not found|topic_id_invalid|topic_deleted/i;

function classifyCreateFailure(err: unknown): TopicCreateFailure {
  if (!(err instanceof GrammyError)) return "unavailable";
  if (NO_RIGHTS.test(err.description)) return "no-rights";
  if (NOT_FORUM.test(err.description)) return "not-forum";
  if (err.error_code === 429) return "rate-limited";
  if (err.error_code >= 500) return "unavailable";
  return "rejected";
}

// Only a 400 carrying a "thread gone" description is a positive deleted
// signal; everything else (other 400s, 403, 429, 5xx, timeout) is `unknown`.
function classifyProbeFailure(err: unknown): TopicProbe {
  if (err instanceof GrammyError && err.error_code === 400 && THREAD_GONE.test(err.description)) {
    return "deleted";
  }
  return "unknown";
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

    // sendChatAction needs no can_manage_topics; its only side effect is a
    // "typing…" indicator of at most 5 s (design.md decision 2).
    async probe(chatId, threadId) {
      try {
        await api.sendChatAction(chatId, "typing", { message_thread_id: threadId }, topicSignal());
        return "live";
      } catch (err) {
        return classifyProbeFailure(err);
      }
    },
  };
}
