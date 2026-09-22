import type { MembershipId, TeamId } from "../../domain/ids";

// Shared audit_log INSERT builder. `id`/`createdAt` are adapter-generated
// (AuditDraft carries neither — see AuditEntry vs AuditDraft in entities.ts)
// because they are storage/audit-trail metadata, not domain decisions.
export interface AuditRowInput {
  id: string;
  teamId: TeamId;
  actorMembershipId: MembershipId;
  targetMembershipId: MembershipId;
  field: string;
  oldValue: string | ArrayBuffer | null;
  // Own version because old_value can be re-encrypted under a different key
  // than new_value (or be plaintext / absent) — see migrations/0001_init.sql
  // "old_key_version" comment (FIX-001).
  oldKeyVersion: number | null;
  newValue: string | ArrayBuffer | null;
  keyVersion: number | null;
  createdAt: number;
}

export function auditInsertStatement(
  db: D1Database,
  input: AuditRowInput,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_log
        (id, team_id, actor_membership_id, target_membership_id, field, old_value, old_key_version, new_value, key_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.teamId,
      input.actorMembershipId,
      input.targetMembershipId,
      input.field,
      input.oldValue,
      input.oldKeyVersion,
      input.newValue,
      input.keyVersion,
      input.createdAt,
    );
}

// FIX-001: when the prior field value was unreadable (RES-001), the domain
// cannot supply a plaintext oldValue to re-encrypt — it never had one. This
// preserves the ORIGINAL stored ciphertext bytes + their true key_version
// verbatim via a SELECT, so the audit trail stays recoverable if the key
// reappears, instead of fabricating or losing the prior value.
//
// MUST be batched BEFORE the profile_fields UPDATE that overwrites the row
// it reads from — db.batch() runs statements in array order, and this
// SELECT would otherwise observe the already-overwritten (new) value.
export interface AuditRowPreservingOldValueInput {
  id: string;
  teamId: TeamId;
  actorMembershipId: MembershipId;
  targetMembershipId: MembershipId;
  membershipId: MembershipId;
  field: string;
  newValue: string | ArrayBuffer | null;
  keyVersion: number | null;
  createdAt: number;
}

export function auditInsertPreservingOldValueStatement(
  db: D1Database,
  input: AuditRowPreservingOldValueInput,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_log
        (id, team_id, actor_membership_id, target_membership_id, field, old_value, old_key_version, new_value, key_version, created_at)
       SELECT ?, ?, ?, ?, ?, value, key_version, ?, ?, ?
       FROM profile_fields WHERE team_id = ? AND membership_id = ? AND field = ?`,
    )
    .bind(
      input.id,
      input.teamId,
      input.actorMembershipId,
      input.targetMembershipId,
      input.field,
      input.newValue,
      input.keyVersion,
      input.createdAt,
      input.teamId,
      input.membershipId,
      input.field,
    );
}
