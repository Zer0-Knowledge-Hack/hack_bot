import type { Context } from "grammy";
import type { Member, Membership, Team } from "../../domain/entities";
import type { MemberRepo, MembershipRepo, TeamRepo } from "../../domain/ports";

// design.md "Data Flow": "handler: build Context{chat, thread, fromUserId}
// -> use case(ports)". This is the ONLY place a grammY `Context` is read —
// everything past this point is plain domain input, never a grammY type
// (mandatory: "domain never imports grammY").
export interface CallerLocation {
  chatId: number;
  userId: number;
  threadId: number | null;
}

export function callerLocation(ctx: Context): CallerLocation | null {
  const chatId = ctx.chat?.id;
  const userId = ctx.from?.id;
  if (chatId === undefined || userId === undefined) return null;
  return {
    chatId,
    userId,
    threadId: ctx.message?.message_thread_id ?? null,
  };
}

// Resolves a Telegram (chatId, userId) pair to this team's existing
// membership, used by group commands that need the caller's own
// membership (e.g. /datachannel's admin check) before delegating to a use
// case. Returns null on any missing link (no team, no member, no
// membership) — callers turn that into a refusal reply.
export async function resolveGroupMembership(
  deps: { teamRepo: TeamRepo; memberRepo: MemberRepo; membershipRepo: MembershipRepo },
  chatId: number,
  userId: number,
): Promise<{ team: Team; member: Member; membership: Membership } | null> {
  const team = await deps.teamRepo.findByChatId(chatId);
  if (!team) return null;
  const member = await deps.memberRepo.findByTelegramUserId(userId);
  if (!member) return null;
  const membership = await deps.membershipRepo.getByMember(team.id, member.id);
  if (!membership) return null;
  return { team, member, membership };
}
