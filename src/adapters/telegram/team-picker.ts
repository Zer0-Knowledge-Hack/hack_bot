import type { Bot, Context } from "grammy";
import { UnauthorizedError } from "../../domain/errors";
import { parseTeamId, TEAM_ID_PATTERN_SOURCE } from "../../domain/ids";
import { selectDmTeam } from "../../domain/usecases/dm-team-selection";
import type { Clock, DmSelectionRepo, Logger, MembershipRepo } from "../../domain/ports";

const SELECTION_PATTERN = new RegExp(`^sel:(${TEAM_ID_PATTERN_SOURCE})$`, "i");

const EVENT = "dm-team-selection";

export interface TeamPickerDeps {
  membershipRepo: MembershipRepo;
  dmSelectionRepo: DmSelectionRepo;
  clock: Clock;
  logger: Logger;
}

export function isPrivateChat(ctx: Context): boolean {
  return ctx.chat?.type === "private";
}

function errorCodeOf(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

// R4-001/R4-003: once `selectDmTeam` has persisted the selection, the
// selection itself is durable — a subsequent Telegram outbound call
// (answerCallbackQuery/reply) failing (e.g. an already-answered or expired
// callback query on a replayed update) MUST NOT turn a successful
// selection into a rethrown error the webhook boundary answers 500 for and
// Telegram retries forever (RES-001). These two calls are therefore
// best-effort: logged on failure, never rethrown. Persistence failures from
// `selectDmTeam` itself are NOT covered here — those still rethrow (see the
// outer try/catch below), since only `UnauthorizedError` is a recognized,
// user-facing refusal.
async function safeAnswerCallbackQuery(ctx: Context, deps: TeamPickerDeps, text?: string): Promise<void> {
  try {
    await (text ? ctx.answerCallbackQuery({ text }) : ctx.answerCallbackQuery());
  } catch (error) {
    deps.logger.log({ event: EVENT, outcome: "error", errorCode: errorCodeOf(error) });
  }
}

async function safeReply(ctx: Context, deps: TeamPickerDeps, text: string): Promise<void> {
  try {
    await ctx.reply(text);
  } catch (error) {
    deps.logger.log({ event: EVENT, outcome: "error", errorCode: errorCodeOf(error) });
  }
}

export function registerTeamPicker(bot: Bot, deps: TeamPickerDeps): void {
  bot.callbackQuery(SELECTION_PATTERN, async (ctx) => {
    const match = SELECTION_PATTERN.exec(ctx.callbackQuery.data);
    const teamId = match?.[1] !== undefined ? parseTeamId(match[1]) : null;
    if (!teamId || !isPrivateChat(ctx) || !ctx.from) return;

    try {
      await selectDmTeam({ telegramUserId: ctx.from.id, teamId }, deps);
    } catch (error) {
      if (!(error instanceof UnauthorizedError)) {
        // Unexpected/transient failure (e.g. D1) persisting the selection —
        // same recognized-vs-rethrown boundary as command-outcome.ts:
        // log it (errorCode only) and rethrow to the webhook top-level
        // boundary instead of silently swallowing it.
        deps.logger.log({ event: EVENT, outcome: "error", errorCode: errorCodeOf(error) });
        throw error;
      }
      deps.logger.log({ event: EVENT, outcome: "refused", errorCode: error.name });
      await safeAnswerCallbackQuery(ctx, deps, "That team is not available to you.");
      await safeReply(ctx, deps, "You are not a member of that team.");
      return;
    }

    deps.logger.log({ event: EVENT, outcome: "ok" });
    await safeAnswerCallbackQuery(ctx, deps);
    await safeReply(ctx, deps, "Team selected. Run your command again to continue.");
  });
}
