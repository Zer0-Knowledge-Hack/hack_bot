// Pure helpers for the participation topic (hackathon-participation design.md
// "Topic name" and decision 7 "Deep link").

const TOPIC_PREFIX = "🏆 ";
// Telegram's forum topic name limit, counted in UTF-16 code units.
const TOPIC_NAME_MAX = 128;
const ELLIPSIS = "…";

// The extracted name is untrusted page text: whitespace (newlines included)
// collapses to one space first, then control (\p{Cc}) and format (\p{Cf},
// bidi spoofing) characters are dropped, and the result is trimmed. Falls
// back to the slug when nothing is left.
export function sanitizeTopicName(name: string | null | undefined, slug: string): string {
  const cleaned = (name ?? "")
    .replace(/\s+/gu, " ")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  return cleaned === "" ? slug : cleaned;
}

export function topicNameFor(name: string | null | undefined, slug: string): string {
  const sanitized = sanitizeTopicName(name, slug);
  const room = TOPIC_NAME_MAX - TOPIC_PREFIX.length;
  if (sanitized.length <= room) return TOPIC_PREFIX + sanitized;
  // Cut at code-point boundaries, leaving one unit for the ellipsis.
  let cut = "";
  for (const ch of sanitized) {
    if (cut.length + ch.length > room - ELLIPSIS.length) break;
    cut += ch;
  }
  return TOPIC_PREFIX + cut + ELLIPSIS;
}

// Telegram's "Copy link" format for a topic (a topic id is its creation
// message id). Only supergroup ids (`-100…`) map to a `t.me/c` link.
export function topicLink(chatId: number, threadId: number): string | null {
  const id = String(chatId);
  if (!id.startsWith("-100")) return null;
  return `https://t.me/c/${id.slice(4)}/${threadId}`;
}
