import type { Api } from "grammy";
import type { ChatAdminChecker } from "../../domain/ports";

// design.md "Admin bootstrap": called once in /setup. `getChatMember`
// rejecting (network error, bot not in chat, etc.) propagates as a thrown
// error — the port contract (ports.ts) requires this so callers can
// distinguish "verified non-admin" from "verification failed".
export function createChatAdminChecker(api: Api): ChatAdminChecker {
  return {
    async isAdmin(chatId: number, userId: number) {
      const member = await api.getChatMember(chatId, userId);
      return member.status === "administrator" || member.status === "creator";
    },
  };
}
