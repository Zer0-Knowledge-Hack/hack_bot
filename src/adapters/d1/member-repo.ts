import type { Member } from "../../domain/entities";
import { asMemberId } from "../../domain/ids";
import type { MemberRepo } from "../../domain/ports";

interface MemberRow {
  id: string;
  telegram_user_id: number;
  created_at: number;
}

function rowToMember(row: MemberRow): Member {
  return {
    id: asMemberId(row.id),
    telegramUserId: row.telegram_user_id,
    createdAt: row.created_at,
  };
}

export function createD1MemberRepo(db: D1Database): MemberRepo {
  return {
    async findByTelegramUserId(telegramUserId: number) {
      const row = await db
        .prepare("SELECT * FROM members WHERE telegram_user_id = ?")
        .bind(telegramUserId)
        .first<MemberRow>();
      return row ? rowToMember(row) : null;
    },

    async upsert(member: Member) {
      // ON CONFLICT DO NOTHING: `telegram_user_id` is UNIQUE. Callers
      // (use cases) always check findByTelegramUserId first, but that
      // pre-read can race with a concurrent writer — a conflict here means
      // a concurrent create already happened, so keep the existing row's
      // id, never reassign it (memberships FK to it). RES-002: the SELECT
      // below returns the row that actually ended up persisted (ours, or
      // the concurrent writer's) so the caller never uses an id that was
      // never inserted.
      await db
        .prepare(
          `INSERT INTO members (id, telegram_user_id, created_at)
           VALUES (?, ?, ?)
           ON CONFLICT (telegram_user_id) DO NOTHING`,
        )
        .bind(member.id, member.telegramUserId, member.createdAt)
        .run();

      const row = await db
        .prepare("SELECT * FROM members WHERE telegram_user_id = ?")
        .bind(member.telegramUserId)
        .first<MemberRow>();
      // `row` cannot be null here: either our INSERT applied, or a
      // concurrent writer's did — either way a row for this
      // telegram_user_id now exists.
      return rowToMember(row!);
    },
  };
}
