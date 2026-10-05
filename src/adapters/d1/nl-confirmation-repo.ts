import {
  parseNlSlotsJson,
  type NlConfirmation,
  type NlMutateIntentId,
} from "../../domain/nl/confirmation";
import { asMembershipId, asTeamId } from "../../domain/ids";
import type { NlConfirmationRepo } from "../../domain/ports";

interface ConfirmationRow {
  id: string;
  team_id: string;
  chat_id: number;
  thread_id: number | null;
  actor_membership_id: string;
  intent: string;
  slots_json: string;
  confirm_message_id: number | null;
  expires_at: number;
  consumed_at: number | null;
  created_at: number;
}

function rowToConfirmation(row: ConfirmationRow): NlConfirmation {
  return {
    id: row.id,
    teamId: asTeamId(row.team_id),
    chatId: row.chat_id,
    threadId: row.thread_id,
    actorMembershipId: asMembershipId(row.actor_membership_id),
    intent: row.intent as NlMutateIntentId,
    slots: parseNlSlotsJson(row.slots_json),
    confirmMessageId: row.confirm_message_id,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    createdAt: row.created_at,
  };
}

export function createD1NlConfirmationRepo(db: D1Database): NlConfirmationRepo {
  return {
    async create(row: NlConfirmation): Promise<void> {
      await db
        .prepare(
          `INSERT INTO nl_confirmations
            (id, team_id, chat_id, thread_id, actor_membership_id, intent, slots_json,
             confirm_message_id, expires_at, consumed_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          row.id,
          row.teamId,
          row.chatId,
          row.threadId,
          row.actorMembershipId,
          row.intent,
          JSON.stringify(row.slots),
          row.confirmMessageId,
          row.expiresAt,
          row.consumedAt,
          row.createdAt,
        )
        .run();
    },

    async findById(id: string): Promise<NlConfirmation | null> {
      const row = await db
        .prepare("SELECT * FROM nl_confirmations WHERE id = ?")
        .bind(id)
        .first<ConfirmationRow>();
      return row ? rowToConfirmation(row) : null;
    },

    async findByConfirmMessage(
      chatId: number,
      confirmMessageId: number,
    ): Promise<NlConfirmation | null> {
      const row = await db
        .prepare(
          "SELECT * FROM nl_confirmations WHERE chat_id = ? AND confirm_message_id = ?",
        )
        .bind(chatId, confirmMessageId)
        .first<ConfirmationRow>();
      return row ? rowToConfirmation(row) : null;
    },

    async tryConsume(id: string, now: number): Promise<boolean> {
      const result = await db
        .prepare(
          `UPDATE nl_confirmations
             SET consumed_at = ?
           WHERE id = ? AND consumed_at IS NULL AND expires_at > ?`,
        )
        .bind(now, id, now)
        .run();
      return (result.meta.changes ?? 0) === 1;
    },

    async cancel(id: string, now: number): Promise<boolean> {
      // Same CAS as tryConsume: marks consumed without execute.
      return this.tryConsume(id, now);
    },
  };
}
