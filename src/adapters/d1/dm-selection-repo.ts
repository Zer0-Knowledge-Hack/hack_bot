import type { DmSelection } from "../../domain/entities";
import { asTeamId } from "../../domain/ids";
import type { DmSelectionRepo } from "../../domain/ports";

// dm_selections is keyed by telegram_user_id (design.md schema) — TTL
// expiry is a domain concern (resolve-dm-team.ts compares expiresAt against
// an injected Clock), not something this adapter filters on read. This
// mirrors `fakeDmSelectionRepo` (test/fakes/index.ts), which also returns
// the raw stored row regardless of expiry.

interface DmSelectionRow {
  telegram_user_id: number;
  team_id: string;
  expires_at: number;
}

function rowToSelection(row: DmSelectionRow): DmSelection {
  return {
    telegramUserId: row.telegram_user_id,
    teamId: asTeamId(row.team_id),
    expiresAt: row.expires_at,
  };
}

export function createD1DmSelectionRepo(db: D1Database): DmSelectionRepo {
  return {
    async get(telegramUserId: number) {
      const row = await db
        .prepare("SELECT * FROM dm_selections WHERE telegram_user_id = ?")
        .bind(telegramUserId)
        .first<DmSelectionRow>();
      return row ? rowToSelection(row) : null;
    },

    async set(selection: DmSelection) {
      // Upsert: a caller re-picking a team (or refreshing the TTL) replaces
      // the prior selection rather than erroring on the PK conflict.
      await db
        .prepare(
          `INSERT INTO dm_selections (telegram_user_id, team_id, expires_at)
           VALUES (?, ?, ?)
           ON CONFLICT (telegram_user_id)
           DO UPDATE SET team_id = excluded.team_id, expires_at = excluded.expires_at`,
        )
        .bind(selection.telegramUserId, selection.teamId, selection.expiresAt)
        .run();
    },
  };
}
