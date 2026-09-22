import type { Membership, Role } from "../../domain/entities";
import { asMemberId, asMembershipId, asTeamId } from "../../domain/ids";
import type { MemberId, MembershipId, TeamId } from "../../domain/ids";
import type { Clock, IdGen, MembershipRepo } from "../../domain/ports";
import { auditInsertStatement } from "./audit";
import { runOrAlreadyExists } from "./errors";

interface MembershipRow {
  id: string;
  team_id: string;
  member_id: string;
  role: Role;
  joined_at: number;
}

function rowToMembership(row: MembershipRow): Membership {
  return {
    id: asMembershipId(row.id),
    teamId: asTeamId(row.team_id),
    memberId: asMemberId(row.member_id),
    role: row.role,
    joinedAt: row.joined_at,
  };
}

export function createD1MembershipRepo(
  db: D1Database,
  idGen: IdGen,
  clock: Clock,
): MembershipRepo {
  return {
    async findByUser(telegramUserId: number) {
      // Only port method allowed to see memberships across teams (design.md
      // "Tenancy") — used solely for DM team resolution.
      const rows = await db
        .prepare(
          `SELECT ms.* FROM memberships ms
           JOIN members m ON m.id = ms.member_id
           WHERE m.telegram_user_id = ?`,
        )
        .bind(telegramUserId)
        .all<MembershipRow>();
      return rows.results.map(rowToMembership);
    },

    async get(teamId: TeamId, membershipId: MembershipId) {
      const row = await db
        .prepare("SELECT * FROM memberships WHERE team_id = ? AND id = ?")
        .bind(teamId, membershipId)
        .first<MembershipRow>();
      return row ? rowToMembership(row) : null;
    },

    async getByMember(teamId: TeamId, memberId: MemberId) {
      const row = await db
        .prepare("SELECT * FROM memberships WHERE team_id = ? AND member_id = ?")
        .bind(teamId, memberId)
        .first<MembershipRow>();
      return row ? rowToMembership(row) : null;
    },

    async listByTeam(teamId: TeamId) {
      const rows = await db
        .prepare("SELECT * FROM memberships WHERE team_id = ?")
        .bind(teamId)
        .all<MembershipRow>();
      return rows.results.map(rowToMembership);
    },

    async create(membership, audit) {
      await runOrAlreadyExists(
        () =>
          db.batch([
            db
              .prepare(
                "INSERT INTO memberships (id, team_id, member_id, role, joined_at) VALUES (?, ?, ?, ?, ?)",
              )
              .bind(
                membership.id,
                membership.teamId,
                membership.memberId,
                membership.role,
                membership.joinedAt,
              ),
            auditInsertStatement(db, {
              id: idGen.newId(),
              teamId: membership.teamId,
              // Self-created membership (setup/join): actor and target are
              // the same person bootstrapping their own membership.
              actorMembershipId: membership.id,
              targetMembershipId: membership.id,
              field: audit.field,
              oldValue: audit.oldValue,
              oldKeyVersion: null,
              newValue: audit.newValue,
              keyVersion: audit.keyVersion,
              createdAt: clock.now(),
            }),
          ]),
        "Already a member of this team",
      );
    },

    async changeRole(teamId, membershipId, role, actorMembershipId, audit, options) {
      // Contract (ports.ts): ONE conditional UPDATE statement re-evaluates
      // "at least one admin remains" at write time (not from a caller-side
      // pre-read, which can be stale under concurrency), batched atomically
      // with an audit INSERT that is itself gated on `changes() = 1` so no
      // audit row is written when the UPDATE did not apply.
      const updateStmt = options?.requireRemainingAdmin
        ? db
            .prepare(
              `UPDATE memberships SET role = ?
               WHERE team_id = ? AND id = ?
                 AND (SELECT COUNT(*) FROM memberships WHERE team_id = ? AND role = 'admin') > 1`,
            )
            .bind(role, teamId, membershipId, teamId)
        : db
            .prepare("UPDATE memberships SET role = ? WHERE team_id = ? AND id = ?")
            .bind(role, teamId, membershipId);

      const auditStmt = db
        .prepare(
          `INSERT INTO audit_log
            (id, team_id, actor_membership_id, target_membership_id, field, old_value, new_value, key_version, created_at)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
           WHERE (SELECT changes()) = 1`,
        )
        .bind(
          idGen.newId(),
          teamId,
          actorMembershipId,
          membershipId,
          audit.field,
          audit.oldValue,
          audit.newValue,
          audit.keyVersion,
          clock.now(),
        );

      const [updateResult] = await db.batch([updateStmt, auditStmt]);
      const applied = (updateResult?.meta.changes ?? 0) === 1;
      return { applied };
    },
  };
}
