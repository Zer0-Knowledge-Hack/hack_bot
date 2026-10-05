import type { Bot, Context } from "grammy";
import { bindDataChannel } from "../../domain/usecases/bind-data-channel";
import { joinTeam } from "../../domain/usecases/join-team";
import { setupTeam } from "../../domain/usecases/setup-team";
import { changeRole } from "../../domain/usecases/change-role";
import { resolveDmTeam } from "../../domain/usecases/dm-team-selection";
import { readProfiles } from "../../domain/usecases/read-profiles";
import { updateProfileField } from "../../domain/usecases/update-profile-field";
import { linkRepoToTopic } from "../../domain/usecases/link-repo-to-topic";
import { unlinkRepo } from "../../domain/usecases/unlink-repo";
import { listRepoLinks } from "../../domain/usecases/list-repo-links";
import { NotFoundError, UnauthorizedError } from "../../domain/errors";
import { parseRepoReference } from "../../domain/github";
import type { RepoFullName } from "../../domain/github";
import type { Membership, ProfileField, ProfileFieldName } from "../../domain/entities";
import type { MembershipId, TeamId } from "../../domain/ids";
import type {
  ChatAdminChecker,
  Clock,
  DmSelectionRepo,
  GithubOrgClaimRepo,
  IdGen,
  IntentClassifier,
  Logger,
  MemberRepo,
  MembershipRepo,
  NlClassifyQuota,
  ProfileRepo,
  RepoTopicLinkRepo,
  TeamRepo,
} from "../../domain/ports";
import { callerLocation, resolveGroupMembership } from "./context";
import type { CallerLocation } from "./context";
import { runCommand } from "./command-outcome";
import { InlineKeyboard } from "grammy";
import { isPrivateChat, registerTeamPicker } from "./team-picker";
import { registerNaturalLanguage } from "./natural-language";
import { registerHackathonCommands } from "./hackathon-commands";
import type { HackathonCommandDeps } from "./hackathon-commands";
import {
  commonCopy,
  dataChannelCopy,
  ROLE_LABELS,
  joinCopy,
  profileCopy,
  repoCopy,
  roleCopy,
  setupCopy,
  teamResolutionCopy,
} from "./copy";
import { REPLY_MAX } from "../../domain/hackathon/format";
import { joinLinesWithinLimit } from "../../domain/text-limit";

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
export interface CommandDeps extends HackathonCommandDeps {
  teamRepo: TeamRepo;
  memberRepo: MemberRepo;
  membershipRepo: MembershipRepo;
  profileRepo: ProfileRepo;
  dmSelectionRepo: DmSelectionRepo;
  chatAdminChecker: ChatAdminChecker;
  githubOrgClaimRepo: GithubOrgClaimRepo;
  repoTopicLinkRepo: RepoTopicLinkRepo;
  clock: Clock;
  idGen: IdGen;
  logger: Logger;
  nlClassifyQuota: NlClassifyQuota;
  intentClassifier: IntentClassifier;
  nlModelPrimary: string;
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
        await ctx.reply(commonCopy.noTeamForChat);
        return null;
      }
      return team.id;
    }
    const resolution = await resolveDmTeam({ telegramUserId: loc.userId }, deps);
    if (resolution.kind === "none") {
      await ctx.reply(teamResolutionCopy.joinFirst);
      return null;
    }
    if (resolution.kind === "needs-selection") {
      const memberships = await deps.membershipRepo.findByUser(loc.userId);
      const keyboard = new InlineKeyboard();
      for (const membership of memberships) keyboard.text(teamResolutionCopy.teamButton(membership.teamId), `sel:${membership.teamId}`).row();
      await ctx.reply(teamResolutionCopy.choose, { reply_markup: keyboard });
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
  return `${field.field}: ${field.unreadable ? profileCopy.unreadable : field.value}`;
}

function memberIdentity(membershipId: MembershipId, ownFields: ProfileField[]): string {
  const fullName = ownFields.find((f) => f.field === "full_name");
  const github = ownFields.find((f) => f.field === "github_username");
  const parts: string[] = [];
  if (fullName) parts.push(fullName.unreadable ? profileCopy.unreadable : fullName.value);
  if (github) parts.push(github.unreadable ? profileCopy.unreadable : `@${github.value}`);
  return parts.length ? ` (${parts.join(", ")})` : "";
}

function formatMemberBlock(membership: Membership, fields: ProfileField[]): string {
  const own = fields.filter((f) => f.membershipId === membership.id);
  const header = profileCopy.memberHeader(membership.id, memberIdentity(membership.id, own), ROLE_LABELS[membership.role]);
  const lines = own.map(formatFieldLine);
  return [header, ...(lines.length ? lines : [profileCopy.noFields])].join("\n");
}

function profileDirectoryReply(memberships: Membership[], fields: ProfileField[], teamId: TeamId): string {
  if (memberships.length === 0) {
    return `${profileCopy.teamHeader(teamId)}\n${profileCopy.noMatch}`;
  }
  return `${profileCopy.teamHeader(teamId)}\n${memberships.map((m) => formatMemberBlock(m, fields)).join("\n\n")}`;
}

// An anonymous group admin's message arrives with `sender_chat` set to the
// group itself (and `from` set to the GroupAnonymousBot placeholder).
function isAnonymousGroupAdmin(ctx: Context): boolean {
  const senderChatId = ctx.message?.sender_chat?.id;
  return senderChatId !== undefined && senderChatId === ctx.chat?.id;
}

// spec: repo-topic-links "Any Member Lists the Team's Claimed-Org Links —
// List reflects current links".
//
// RES-001: Telegram rejects a message over 4096 chars — an unbounded reply
// here would make ctx.reply throw, runCommand would rethrow it as an
// unrecognized error (it is not a domain error), and the route would answer
// 500, which Telegram retries forever, permanently breaking /repos for any
// team with enough links. `joinLinesWithinLimit` keeps whole lines and ends
// with a fixed "…y N más" summary line once the limit would be exceeded.
function reposReply(links: Array<{ repoFullName: string; threadId: number }>): string {
  const lines = links.map((l) => repoCopy.line(l.repoFullName, l.threadId));
  return joinLinesWithinLimit(lines, REPLY_MAX, repoCopy.none);
}

// READ-001: the genuinely shared part of `/linkrepo` and `/unlinkrepo` —
// the topic gate (spec: "Admin-Only Link/Unlink Inside a Topic") and the
// repo argument parsing (`owner/repo` or a pasted GitHub URL). Everything
// else (which use case runs, which errors it can throw, the reply text)
// differs per command and is
// registered explicitly below, the same way `/setup`/`/join`/`/datachannel`
// each get their own `bot.command` block instead of a shared branching loop.
async function resolveLinkCommandTarget(
  ctx: Context,
  deps: CommandDeps,
  command: string,
  action: "link" | "unlink",
  rawRepoArg: string,
): Promise<{ loc: CallerLocation; threadId: number; repo: RepoFullName } | null> {
  const loc = callerLocation(ctx);
  if (!loc) return null;
  // The null-thread check below covers both the group's general chat AND a
  // DM (a DM message never carries message_thread_id) with the same "run
  // inside the intended topic" instruction /datachannel already uses —
  // there is no separate isPrivateChat branch, mirroring /datachannel's own
  // gate (design.md "Link and unlink need an admin, the thread must not be
  // null, the same refusal as /datachannel").
  if (loc.threadId === null) {
    deps.logger.log({ event: `${action}-repo-to-topic`, outcome: "refused", errorCode: "NoThread" });
    await ctx.reply(repoCopy.topicRequired[action]);
    return null;
  }
  const threadId = loc.threadId;
  const repo = parseRepoReference(rawRepoArg);
  if (!repo) {
    await ctx.reply(repoCopy.usage(command));
    return null;
  }
  return { loc, threadId, repo };
}

export function registerCommands(bot: Bot, deps: CommandDeps): void {
  registerTeamPicker(bot, deps);
  registerHackathonCommands(bot, deps);
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
      await ctx.reply(setupCopy.privateChat);
      return;
    }
    if (isAnonymousGroupAdmin(ctx)) {
      deps.logger.log({ event: "setup-team", outcome: "refused", errorCode: "AnonymousAdmin" });
      await ctx.reply(setupCopy.anonymousAdmin);
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
          AlreadyExistsError: setupCopy.alreadyExists,
          ChatAdminCheckFailedError: setupCopy.adminCheckFailed,
          UnauthorizedError: setupCopy.notGroupAdmin,
        },
      },
      async () => {
        await setupTeam({ chatId: loc.chatId, callerTelegramUserId: loc.userId }, deps);
        return { okReply: setupCopy.created };
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
          AlreadyExistsError: joinCopy.alreadyMember,
          NotFoundError: commonCopy.noTeamForChat,
        },
      },
      async () => {
        await joinTeam({ chatId: loc.chatId, callerTelegramUserId: loc.userId }, deps);
        return { okReply: joinCopy.joined };
      },
    );
  });

  bot.command("datachannel", async (ctx) => {
    const loc = callerLocation(ctx);
    if (!loc) return;
    if (loc.threadId === null) {
      deps.logger.log({ event: "bind-data-channel", outcome: "refused", errorCode: "NoThread" });
      await ctx.reply(dataChannelCopy.topicRequired);
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
          UnauthorizedError: dataChannelCopy.adminOnly,
          NotFoundError: commonCopy.membershipCheckFailed("datachannel"),
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
          okReply: dataChannelCopy.bound,
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
            UnauthorizedError: profileCopy.dataChannelOnly,
            NotFoundError: commonCopy.notMember,
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
        await ctx.reply(profileCopy.setUsage);
        return;
      }
      await runCommand(
        {
          event: "update-profile", logger: deps.logger, reply: (text) => ctx.reply(text),
          errorReplies: { UnauthorizedError: profileCopy.ownOnly, NotFoundError: commonCopy.notMember },
        },
        async () => {
          const actor = await resolveActorMembership(teamId, loc.userId, deps);
          await updateProfileField({ teamId, actorMembershipId: actor.id, targetMembershipId: actor.id, field: field as ProfileFieldName, value, keyVersion: null }, deps);
          return { okReply: profileCopy.updated(teamId), teamId };
        },
      );
      return;
    }
    await ctx.reply(profileCopy.usage);
  });

  for (const [command, newRole] of [["promote", "admin"], ["demote", "member"]] as const) {
    bot.command(command, async (ctx) => {
      const loc = callerLocation(ctx);
      if (!loc) return;
      const teamId = await resolveCommandTeam(ctx, deps, `${command}-team-resolution`);
      if (!teamId) return;
      const targetMembershipId = ctx.match.trim() as MembershipId;
      if (!targetMembershipId) {
        await ctx.reply(roleCopy.usage(command));
        return;
      }
      await runCommand(
        {
          event: `${command}-member`, logger: deps.logger, reply: (text) => ctx.reply(text),
          errorReplies: { UnauthorizedError: roleCopy.adminOnly, NotFoundError: roleCopy.notFound, LastAdminError: roleCopy.lastAdmin },
        },
        async () => {
          const actor = await resolveActorMembership(teamId, loc.userId, deps);
          await changeRole({ teamId, actorMembershipId: actor.id, targetMembershipId, newRole }, deps);
          return { okReply: roleCopy.changed(newRole, teamId), teamId };
        },
      );
    });
  }

  // /linkrepo: admin-only, must run inside a forum topic (spec:
  // repo-topic-links "Admin-Only Link/Unlink Inside a Topic").
  bot.command("linkrepo", async (ctx) => {
    const target = await resolveLinkCommandTarget(ctx, deps, "linkrepo", "link", ctx.match);
    if (!target) return;
    const { loc, threadId, repo } = target;
    await runCommand(
      {
        event: "link-repo-to-topic",
        logger: deps.logger,
        reply: (text) => ctx.reply(text),
        // Every domain error linkRepoToTopic can throw MUST be listed here
        // — see command-outcome.ts.
        errorReplies: {
          UnauthorizedError: repoCopy.linkAdminOnly,
          NotFoundError: commonCopy.membershipCheckFailed("linkrepo"),
          OrgNotClaimedError: repoCopy.orgNotClaimed,
        },
      },
      async () => {
        const resolved = await resolveGroupMembership(deps, loc.chatId, loc.userId);
        if (!resolved) {
          throw new UnauthorizedError("Only a team admin may link a repo");
        }
        const result = await linkRepoToTopic(
          { teamId: resolved.team.id, actorMembershipId: resolved.membership.id, repo, threadId },
          deps,
        );
        // spec: repo-topic-links "One Topic Per Repo, Re-Link Moves It" —
        // the reply MUST name the previous topic, not just confirm success.
        const okReply = result.previousThreadId === null
          ? commonCopy.linkedHere(repo)
          : repoCopy.moved(repo, result.previousThreadId, threadId);
        return { okReply, teamId: resolved.team.id };
      },
    );
  });

  // /unlinkrepo: admin-only, must run inside a forum topic — same gate as
  // /linkrepo (spec: repo-topic-links "Admin-Only Link/Unlink Inside a
  // Topic"). unlinkRepo never throws OrgNotClaimedError (it has no claim
  // gate — spec: unlinking an already-linked repo requires no org claim
  // check), so that mapping is intentionally omitted here, unlike
  // /linkrepo's errorReplies.
  bot.command("unlinkrepo", async (ctx) => {
    const target = await resolveLinkCommandTarget(ctx, deps, "unlinkrepo", "unlink", ctx.match);
    if (!target) return;
    const { loc, repo } = target;
    await runCommand(
      {
        event: "unlink-repo-to-topic",
        logger: deps.logger,
        reply: (text) => ctx.reply(text),
        // Every domain error unlinkRepo can throw MUST be listed here —
        // see command-outcome.ts.
        errorReplies: {
          UnauthorizedError: repoCopy.unlinkAdminOnly,
          NotFoundError: commonCopy.membershipCheckFailed("unlinkrepo"),
        },
      },
      async () => {
        const resolved = await resolveGroupMembership(deps, loc.chatId, loc.userId);
        if (!resolved) {
          throw new UnauthorizedError("Only a team admin may unlink a repo");
        }
        const removed = await unlinkRepo(
          { teamId: resolved.team.id, actorMembershipId: resolved.membership.id, repo },
          deps,
        );
        return {
          okReply: removed ? repoCopy.unlinked(repo) : repoCopy.notLinked(repo),
          teamId: resolved.team.id,
        };
      },
    );
  });

  // /repos: any registered team member, anywhere in the team's group or DM
  // (spec: repo-topic-links "Any Member Lists the Team's Claimed-Org
  // Links"). Read-only, so it follows /profile's resolveCommandTeam
  // convention (group + DM team picker) rather than /datachannel's
  // topic-only gate.
  bot.command("repos", async (ctx) => {
    const loc = callerLocation(ctx);
    if (!loc) return;
    const teamId = await resolveCommandTeam(ctx, deps, "list-repo-links-team-resolution");
    if (!teamId) return;
    await runCommand(
      {
        event: "list-repo-links",
        logger: deps.logger,
        reply: (text) => ctx.reply(text),
        errorReplies: {
          NotFoundError: commonCopy.notMember,
        },
      },
      async () => {
        const actor = await resolveActorMembership(teamId, loc.userId, deps);
        const links = await listRepoLinks({ teamId, actorMembershipId: actor.id }, deps);
        return { okReply: reposReply(links), teamId };
      },
    );
  });

  // After slash commands so command handlers win; NL only sees leftover text.
  registerNaturalLanguage(bot, deps);
}
