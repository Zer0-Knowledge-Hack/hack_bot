import { Bot } from "grammy";
import type { UserFromGetMe } from "grammy/types";

// Thin factory only — `botInfo` comes from the `BOT_INFO` var so grammY
// never issues a `getMe` call per request (design.md "Telegram lib").
export function createBot(token: string, botInfo: UserFromGetMe): Bot {
  return new Bot(token, { botInfo });
}
