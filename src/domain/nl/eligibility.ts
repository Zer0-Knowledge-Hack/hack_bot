// Pure NL eligibility helpers (natural-language-text design.md).
// Domain-owned: no grammY imports.

export const NL_TEXT_MAX = 500;

export type NlChatType = "private" | "group" | "supergroup" | "channel";

export interface NlEligibilityInput {
  chatType: NlChatType;
  text: string | undefined;
  botUsername: string;
  botId: number;
  // True when the message carries a bot_command entity (slash command).
  isCommand: boolean;
  // `reply_to_message.from.id` when present, else null.
  replyFromBotId: number | null;
}

export type NlEligibilityResult =
  | { eligible: false }
  | { eligible: true; classifiedText: string };

export type StubNlIntent = "help" | "unknown";

const HELP_PATTERN =
  /^(?:¿?\s*)?(?:ayuda|help|qué puedes(?: hacer)?|que puedes(?: hacer)?|cómo te uso|como te uso|qué sabes hacer|que sabes hacer)\s*\??$/iu;

// PR1 stub classifier: keyword help vs unknown. Replaced by IntentClassifier in PR2.
export function stubNlIntent(classifiedText: string): StubNlIntent {
  const normalized = classifiedText.trim().replace(/\s+/gu, " ");
  return HELP_PATTERN.test(normalized) ? "help" : "unknown";
}

function mentionPattern(botUsername: string): RegExp {
  const escaped = botUsername.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`@${escaped}\\b`, "giu");
}

export function messageMentionsBot(text: string, botUsername: string): boolean {
  if (botUsername.trim() === "") return false;
  return mentionPattern(botUsername).test(text);
}

export function stripBotMentions(text: string, botUsername: string): string {
  if (botUsername.trim() === "") return text.trim();
  return text.replace(mentionPattern(botUsername), " ").replace(/\s+/gu, " ").trim();
}

export function isEligibleNlMessage(input: NlEligibilityInput): NlEligibilityResult {
  if (input.chatType === "private" || input.chatType === "channel") {
    return { eligible: false };
  }
  if (input.isCommand) return { eligible: false };
  const text = input.text;
  if (text === undefined || text.trim() === "") return { eligible: false };

  const mentioned = messageMentionsBot(text, input.botUsername);
  const replyToBot = input.replyFromBotId === input.botId;
  if (!mentioned && !replyToBot) return { eligible: false };

  const classifiedText = stripBotMentions(text, input.botUsername);
  if (classifiedText.length === 0 || classifiedText.length > NL_TEXT_MAX) {
    return { eligible: false };
  }
  return { eligible: true, classifiedText };
}
