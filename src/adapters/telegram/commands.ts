import type { Bot, Context } from "grammy";
import { bindDataChannel } from "../../domain/usecases/bind-data-channel";
import { joinTeam } from "../../domain/usecases/join-team";
import { setupTeam } from "../../domain/usecases/setup-team";
import { changeRole } from "../../domain/usecases/change-role";
import { resolveDmTeam } from "../../domain/usecases/dm-team-selection";
import { readProfiles } from "../../domain/usecases/read-profiles";
import { updateProfileField } from "../../domain/usecases/update-profile-field";
import { NotFoundError, UnauthorizedError } from "../../domain/errors";
import type { Membership, ProfileField, ProfileFieldName } from "../../domain/entities";
import type { MembershipId, TeamId } from "../../domain/ids";
import type {
  ChatAdminChecker,
  Clock,
  DmSelectionRepo,
  IdGen,
  Logger,
  MemberRepo,
  MembershipRepo,
  ProfileRepo,
  TeamRepo,
} from "../../domain/ports";
import { callerLocation, resolveGroupMembership } from "./context";
import { runCommand } from "./command-outcome";
import { InlineKeyboard } from "grammy";
import { isPrivateChat, registerTeamPicker } from "./team-picker";

// grammY is a thin edge adapter only: every handler below extracts caller
// location, calls exactly one domain use case (or port read for a simple
// gate) through `runCommand`, and maps the result/error to a reply. No
// business rule (policy, tenancy, audit shape) lives here — see design.md
// "Data Flow".
//
// RES-001 webhook response policy (see command-outcome.ts for the full
// rationale): `runCommand`'s `errorReplies` map is the ONE place a command
// declares which domain errors it recognizes as user-facing refusals
// (log "refused", reply, 200). Any error NOT in that map is treated as an
// unexpected/transient infrastructure failure — logged (errorCode only)
// and rethrown to the single top-level boundary (src/index.ts), which
// answers 500 instead of silently swallowing it into a misleading 200
// reply. Extracting this into one helper (instead of one try/catch +
// instanceof chain per command) is what makes a missing domain-error case
// detectable at the map literal instead of silently falling through to a
// generic catch-all reply — that drift already happened twice to
// /datachannel (see FIX-001).
export interface CommandDeps {
  teamRepo: TeamRepo;
  memberRepo: MemberRepo;
  membershipRepo: MembershipRepo;
  profileRepo: ProfileRepo;
  dmSelectionRepo: DmSelectionRepo;
  chatAdminChecker: ChatAdminChecker;
  clock: Clock;
  idGen: IdGen;
  logger: Logger;
}

const profileFields = new Set<ProfileFieldName>([
  "full_name", "emails", "social_links", "github_username",
]);

// Resolves the team a group/DM command applies to. `event` names the
// caller (e.g. "profile-team-resolution") so log lines below are
// attributable to the command that triggered this resolution — mirrors the
// event naming already used by `runCommand` call sites.
//
// R3-002: the group branch used to return `null` silently when the chat has
// no registered team, leaving the caller with no reply and no log line.
// R4-002: the D1 reads below (`teamRepo.findByChatId`, `resolveDmTeam`) used
// to run entirely outside any logged boundary, so an unexpected D1 failure
// here escaped unlogged and was indistinguishable from every other silent
// return. Both are fixed together: the D1 reads run inside a try/catch that
// logs an "error" outcome (errorCode only, per design.md "Logging") and
// rethrows on any unrecognized failure — same shape as `runCommand`'s own
// unrecognized-error branch (command-outcome.ts) — while a legitimate
// "no team for this chat" outcome is logged as "refused" and replies with
// the same text /join already uses for the equivalent case.
async function resolveCommandTeam(ctx: Parameters<typeof callerLocation>[0], deps: CommandDeps, event: string): Promise<TeamId | null> {
  const loc = callerLocation(ctx);
  if (!loc) return null;
  try {
    if (!isPrivateChat(ctx)) {
      const team = await deps.teamRepo.findByChatId(loc.chatId);
      if (!team) {
        deps.logger.log({ event, outcome: "refused", errorCode: "NoTeamForChat" });
        await ctx.reply("No team is registered for this chat. Ask an admin to run /setup.");
        return null;
      }
      return team.id;
    }
    const resolution = await resolveDmTeam({ telegramUserId: loc.userId }, deps);
    if (resolution.kind === "none") {
      await ctx.reply("Join a team first by running /join in its group.");
      return null;
    }
    if (resolution.kind === "needs-selection") {
      const memberships = await deps.membershipRepo.findByUser(loc.userId);
      const keyboard = new InlineKeyboard();
      for (const membership of memberships) keyboard.text(`Team ${membership.teamId}`, `sel:${membership.teamId}`).row();
      await ctx.reply("Choose which team this command applies to.", { reply_markup: keyboard });
      return null;
    }
    return resolution.teamId;
  } catch (err) {
    const errorCode = err instanceof Error ? err.name : "UnknownError";
    deps.logger.log({ event, outcome: "error", errorCode });
    throw err;
  }
}

async function resolveActorMembership(teamId: TeamId, telegramUserId: number, deps: CommandDeps) {
  const member = await deps.memberRepo.findByTelegramUserId(telegramUserId);
  if (!member) throw new NotFoundError("Caller is not a registered member");
  const membership = await deps.membershipRepo.getByMember(teamId, member.id);
  if (!membership) throw new NotFoundError("Caller is not a member of this team");
  return membership;
}

// R1-001 (product decision: SHARED DIRECTORY): any registered member of the
// resolved team may read all same-team profiles in the data channel or DM
// (team_id scoping and data-channel gating are unchanged — enforced by
// `readProfiles` before this ever runs). `/profile show` (no target) MUST
// return the whole team directory grouped by member; `/profile show
// <membershipId>` returns that one member only. Each block identifies its
// owner (membership id, plus github_username/full_name when set) and role.

function formatFieldLine(field: ProfileField): string {
  return `${field.field}: ${field.unreadable ? "unreadable" : field.value}`;
}

function memberIdentity(membershipId: MembershipId, ownFields: ProfileField[]): string {
  const fullName = ownFields.find((f) => f.field === "full_name");
  const github = ownFields.find((f) => f.field === "github_username");
  const parts: string[] = [];
  if (fullName) parts.push(fullName.unreadable ? "unreadable" : fullName.value);
  if (github) parts.push(github.unreadable ? "unreadable" : `@${github.value}`);
  return parts.length ? ` (${parts.join(", ")})` : "";
}

function formatMemberBlock(membership: Membership, fields: ProfileField[]): string {
  const own = fields.filter((f) => f.membershipId === membership.id);
  const header = `Member ${membership.id}${memberIdentity(membership.id, own)} — role: ${membership.role}`;
  const lines = own.map(formatFieldLine);
  return [header, ...(lines.length ? lines : ["No profile fields set."])].join("\n");
}

function profileDirectoryReply(memberships: Membership[], fields: ProfileField[], teamId: TeamId): string {
  if (memberships.length === 0) {
    return `Team ${teamId}\nNo matching member found.`;
  }
  return `Team ${teamId}\n${memberships.map((m) => formatMemberBlock(m, fields)).join("\n\n")}`;
}

// An anonymous group admin's message arrives with `sender_chat` set to the
// group itself (and `from` set to the GroupAnonymousBot placeholder).
function isAnonymousGroupAdmin(ctx: Context): boolean {
  const senderChatId = ctx.message?.sender_chat?.id;
  return senderChatId !== undefined && senderChatId === ctx.chat?.id;
}

export function registerCommands(bot: Bot, deps: CommandDeps): void {
  registerTeamPicker(bot, deps);
  bot.command("setup", async (ctx) => {
    const loc = callerLocation(ctx);
    if (!loc) return;
    // Telegram-specific pre-checks, answered before any admin lookup: a DM
    // has no group to register, and an anonymous admin's `from` is the
    // GroupAnonymousBot, which getChatMember never reports as an admin —
    // both would otherwise fall through to a misleading "not an admin"
    // refusal.
    if (isPrivateChat(ctx)) {
      deps.logger.log({ event: "setup-team", outcome: "refused", errorCode: "PrivateChat" });
      await ctx.reply("Run /setup inside the group you want to register as a team, not in a private chat.");
      return;
    }
    if (isAnonymousGroupAdmin(ctx)) {
      deps.logger.log({ event: "setup-team", outcome: "refused", errorCode: "AnonymousAdmin" });
      await ctx.reply(
        'You are posting as an anonymous admin, so your admin status cannot be verified. Turn off "Remain anonymous" in your admin rights and run /setup again.',
      );
      return;
    }
    await runCommand(
      {
        event: "setup-team",
        logger: deps.logger,
        reply: (text) => ctx.reply(text),
        // Every domain error setupTeam can throw MUST be listed here (or
        // deliberately left unrecognized, which rethrows to a 500) — see
        // command-outcome.ts.
        errorReplies: {
          AlreadyExistsError: "A team is already registered for this chat.",
          ChatAdminCheckFailedError: "Could not verify your admin status. Please try again.",
          UnauthorizedError: "Only a Telegram group admin can run /setup.",
        },
      },
      async () => {
        await setupTeam({ chatId: loc.chatId, callerTelegramUserId: loc.userId }, deps);
        return { okReply: "Team created. You are the first admin." };
      },
    );
  });

  bot.command("join", async (ctx) => {
    const loc = callerLocation(ctx);
    if (!loc) return;
    await runCommand(
      {
        event: "join-team",
        logger: deps.logger,
        reply: (text) => ctx.reply(text),
        // Every domain error joinTeam can throw MUST be listed here — see
        // command-outcome.ts.
        errorReplies: {
          AlreadyExistsError: "You are already a member of this team.",
          NotFoundError: "No team is registered for this chat. Ask an admin to run /setup.",
        },
      },
      async () => {
        await joinTeam({ chatId: loc.chatId, callerTelegramUserId: loc.userId }, deps);
        return { okReply: "You joined the team." };
      },
    );
  });

  bot.command("datachannel", async (ctx) => {
    const loc = callerLocation(ctx);
    if (!loc) return;
    if (loc.threadId === null) {
      deps.logger.log({ event: "bind-data-channel", outcome: "refused", errorCode: "NoThread" });
      await ctx.reply(
        "Run /datachannel inside the topic you want to use as the team's data channel.",
      );
      return;
    }
    const threadId = loc.threadId;
    await runCommand(
      {
        event: "bind-data-channel",
        logger: deps.logger,
        reply: (text) => ctx.reply(text),
        // Every domain error bindDataChannel can throw MUST be listed
        // here. FIX-001: NotFoundError (actor membership or team gone by
        // the time bindDataChannel re-reads them — a real TOCTOU window
        // after resolveGroupMembership below) was previously MISSING from
        // this set, so it fell through to the unrecognized-error/rethrow
        // branch and turned a real, recoverable refusal into a permanent
        // 500 that Telegram would retry forever.
        errorReplies: {
          UnauthorizedError: "Only a team admin may bind the data channel.",
          NotFoundError: "Could not verify your team membership. Please try /datachannel again.",
        },
      },
      async () => {
        // resolveGroupMembership performs repo reads (D1) too, same as
        // setupTeam/joinTeam's calls — it runs INSIDE this action so an
        // infra failure here follows the same recognized-vs-rethrown
        // boundary as bindDataChannel's own errors, instead of sitting
        // outside any error handling.
        const resolved = await resolveGroupMembership(deps, loc.chatId, loc.userId);
        if (!resolved) {
          // No team/member/membership link at all for this caller: same
          // user-facing refusal and recognized-error path as
          // bindDataChannel's own admin-role check below (both mean "you
          // may not bind the data channel").
          throw new UnauthorizedError("Only a team admin may bind the data channel");
        }
        await bindDataChannel(
          {
            teamId: resolved.team.id,
            actorMembershipId: resolved.membership.id,
            threadId,
          },
          deps,
        );
        return {
          okReply: "This topic is now the team's data channel.",
          teamId: resolved.team.id,
        };
      },
    );
  });

  bot.command("profile", async (ctx) => {
    const loc = callerLocation(ctx);
    if (!loc) return;
    const [operation, ...args] = ctx.match.trim().split(/\s+/);
    const teamId = await resolveCommandTeam(ctx, deps, "profile-team-resolution");
    if (!teamId) return;

    if (operation === "show") {
      await runCommand(
        {
          event: "read-profiles", logger: deps.logger, reply: (text) => ctx.reply(text),
          errorReplies: {
            UnauthorizedError: "Member data is available only in the team's data channel.",
            NotFoundError: "You are not a member of this team.",
          },
        },
        async () => {
          const targetMembershipId = args[0] as MembershipId | undefined;
          const fields = await readProfiles({
            context: isPrivateChat(ctx) ? { kind: "dm", teamId } : { kind: "group", chatId: loc.chatId, threadId: loc.threadId },
            callerTelegramUserId: loc.userId,
            targetMembershipId,
          }, deps);
          // R1-001: fields alone don't carry the owner's role — fetch the
          // relevant membership record(s) too so the directory can identify
          // each block's owner and role (design.md "Tenancy": still
          // team-scoped, via the already-authorized `teamId`).
          const memberships = targetMembershipId
            ? await deps.membershipRepo.get(teamId, targetMembershipId).then((m) => (m ? [m] : []))
            : await deps.membershipRepo.listByTeam(teamId);
          return { okReply: profileDirectoryReply(memberships, fields, teamId), teamId };
        },
      );
      return;
    }

    if (operation === "set") {
      const field = args.shift();
      const value = args.join(" ");
      if (!field || !profileFields.has(field as ProfileFieldName) || !value) {
        await ctx.reply("Usage: /profile set <full_name|emails|social_links|github_username> <value>");
        return;
      }
      await runCommand(
        {
          event: "update-profile", logger: deps.logger, reply: (text) => ctx.reply(text),
          errorReplies: { UnauthorizedError: "You may only edit your own profile.", NotFoundError: "You are not a member of this team." },
        },
        async () => {
          const actor = await resolveActorMembership(teamId, loc.userId, deps);
          await updateProfileField({ teamId, actorMembershipId: actor.id, targetMembershipId: actor.id, field: field as ProfileFieldName, value, keyVersion: null }, deps);
          return { okReply: `Profile updated for team ${teamId}.`, teamId };
        },
      );
      return;
    }
    await ctx.reply("Usage: /profile show [membership-id] or /profile set <field> <value>");
  });

  for (const [command, newRole] of [["promote", "admin"], ["demote", "member"]] as const) {
    bot.command(command, async (ctx) => {
      const loc = callerLocation(ctx);
      if (!loc) return;
      const teamId = await resolveCommandTeam(ctx, deps, `${command}-team-resolution`);
      if (!teamId) return;
      const targetMembershipId = ctx.match.trim() as MembershipId;
      if (!targetMembershipId) {
        await ctx.reply(`Usage: /${command} <membership-id>`);
        return;
      }
      await runCommand(
        {
          event: `${command}-member`, logger: deps.logger, reply: (text) => ctx.reply(text),
          errorReplies: { UnauthorizedError: "Only a team admin may change roles.", NotFoundError: "Member not found in this team.", LastAdminError: "The last team admin cannot be demoted." },
        },
        async () => {
          const actor = await resolveActorMembership(teamId, loc.userId, deps);
          await changeRole({ teamId, actorMembershipId: actor.id, targetMembershipId, newRole }, deps);
          return { okReply: `Member role changed to ${newRole} for team ${teamId}.`, teamId };
        },
      );
    });
  }
}
