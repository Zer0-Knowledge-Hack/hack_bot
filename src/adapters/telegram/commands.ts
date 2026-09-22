import type { Bot } from "grammy";
import { bindDataChannel } from "../../domain/usecases/bind-data-channel";
import { joinTeam } from "../../domain/usecases/join-team";
import { setupTeam } from "../../domain/usecases/setup-team";
import { UnauthorizedError } from "../../domain/errors";
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

export function registerCommands(bot: Bot, deps: CommandDeps): void {
  bot.command("setup", async (ctx) => {
    const loc = callerLocation(ctx);
    if (!loc) return;
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
}
