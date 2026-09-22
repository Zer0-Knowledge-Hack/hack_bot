import type { AuditDraft, Team } from "../../domain/entities";
import { asTeamId } from "../../domain/ids";
import type { MembershipId, TeamId } from "../../domain/ids";
import type { Clock, IdGen, TeamRepo } from "../../domain/ports";
import { auditInsertStatement } from "./audit";
import { runOrAlreadyExists } from "./errors";

interface TeamRow {
  id: string;
  telegram_chat_id: number;
  data_topic_thread_id: number | null;
  created_at: number;
}

function rowToTeam(row: TeamRow): Team {
  return {
    id: asTeamId(row.id),
    chatId: row.telegram_chat_id,
    dataTopicThreadId: row.data_topic_thread_id,
    createdAt: row.created_at,
  };
}

export function createD1TeamRepo(
  db: D1Database,
  idGen: IdGen,
  clock: Clock,
): TeamRepo {
  return {
    async findByChatId(chatId) {
      const row = await db
        .prepare("SELECT * FROM teams WHERE telegram_chat_id = ?")
        .bind(chatId)
        .first<TeamRow>();
      return row ? rowToTeam(row) : null;
    },

    async get(teamId: TeamId) {
      const row = await db
        .prepare("SELECT * FROM teams WHERE id = ?")
        .bind(teamId)
        .first<TeamRow>();
      return row ? rowToTeam(row) : null;
    },

    async create(team: Team) {
      await runOrAlreadyExists(
        () =>
          db
            .prepare(
              "INSERT INTO teams (id, telegram_chat_id, data_topic_thread_id, created_at) VALUES (?, ?, ?, ?)",
            )
            .bind(team.id, team.chatId, team.dataTopicThreadId, team.createdAt)
            .run(),
        "A team is already registered for this chat",
      );
    },

    async bindDataChannel(
      teamId: TeamId,
      threadId: number,
      actorMembershipId: MembershipId,
      audit: AuditDraft,
    ) {
      await db.batch([
        db
          .prepare("UPDATE teams SET data_topic_thread_id = ? WHERE id = ?")
          .bind(threadId, teamId),
        auditInsertStatement(db, {
          id: idGen.newId(),
          teamId,
          // Team-level action: actor and target are the same membership —
          // there is no separate "target member" for binding a data channel.
          actorMembershipId,
          targetMembershipId: actorMembershipId,
          field: audit.field,
          oldValue: audit.oldValue,
          oldKeyVersion: null,
          newValue: audit.newValue,
          keyVersion: audit.keyVersion,
          createdAt: clock.now(),
        }),
      ]);
    },
  };
}
