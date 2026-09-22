import type { ProfileField, ProfileFieldName } from "../../domain/entities";
import { FieldUnreadableError } from "../../domain/errors";
import { asMembershipId, asTeamId } from "../../domain/ids";
import type { MembershipId, TeamId } from "../../domain/ids";
import type { Clock, FieldCipher, IdGen, ProfileRepo } from "../../domain/ports";
import {
  auditInsertPreservingOldValueStatement,
  auditInsertStatement,
} from "./audit";
import { fromBlob, toBlob } from "./blob";

// full_name/emails/social_links are PII and MUST be AES-GCM encrypted at
// rest (design.md "pii-protection"); github_username is used by later
// integrations and stays plaintext — its `key_version` column is NULL,
// which is this schema's marker for "not encrypted" (see migrations/0001_init.sql).
const ENCRYPTED_FIELDS: ReadonlySet<ProfileFieldName> = new Set([
  "full_name",
  "emails",
  "social_links",
]);

// AAD binds a ciphertext to its table+team+row+field (design.md "Ciphertext
// binding") so a value copied to another row/tenant fails to decrypt. The
// same AAD scheme is reused for the audit_log old/new copies of the same
// field, since they represent the same logical value.
function fieldAad(teamId: TeamId, membershipId: MembershipId, field: string): string {
  return `profile_fields|${teamId}|${membershipId}|${field}`;
}

interface ProfileFieldRow {
  team_id: string;
  membership_id: string;
  field: ProfileFieldName;
  value: ArrayBuffer;
  key_version: number | null;
  updated_at: number;
}

export function createD1ProfileRepo(
  db: D1Database,
  idGen: IdGen,
  clock: Clock,
  fieldCipher: FieldCipher,
): ProfileRepo {
  async function decryptRow(row: ProfileFieldRow): Promise<ProfileField> {
    const teamId = asTeamId(row.team_id);
    const membershipId = asMembershipId(row.membership_id);
    const bytes = fromBlob(row.value) as Uint8Array;

    if (row.key_version === null) {
      return {
        teamId,
        membershipId,
        field: row.field,
        value: new TextDecoder().decode(bytes),
        keyVersion: row.key_version,
        updatedAt: row.updated_at,
      };
    }

    // RES-001: isolate a per-field decrypt failure — one unreadable field
    // (wrong AAD, unknown key version, corrupted ciphertext) MUST NOT fail
    // the whole listing (design.md "PII Never Logged"). The broken field is
    // returned marked `unreadable`, never dropped and never leaking
    // ciphertext or WebCrypto error detail to the caller.
    try {
      const value = await fieldCipher.decrypt(
        bytes,
        row.key_version,
        fieldAad(teamId, membershipId, row.field),
      );
      return {
        teamId,
        membershipId,
        field: row.field,
        value,
        keyVersion: row.key_version,
        updatedAt: row.updated_at,
      };
    } catch (err) {
      if (!(err instanceof FieldUnreadableError)) throw err;
      return {
        teamId,
        membershipId,
        field: row.field,
        value: "",
        keyVersion: row.key_version,
        updatedAt: row.updated_at,
        unreadable: true,
      };
    }
  }

  // Encrypts (or UTF-8-encodes, for plaintext fields) one logical value for
  // storage. Returns the stored BLOB bytes plus the key_version to persist
  // alongside it (NULL for plaintext fields, the cipher's active version
  // for encrypted ones — never the caller-supplied keyVersion, since only
  // this adapter knows the storage's active key).
  async function encodeForStorage(
    field: ProfileFieldName,
    aad: string,
    plain: string,
  ): Promise<{ value: Uint8Array; keyVersion: number | null }> {
    if (!ENCRYPTED_FIELDS.has(field)) {
      return { value: new TextEncoder().encode(plain), keyVersion: null };
    }
    const { value, keyVersion } = await fieldCipher.encrypt(plain, aad);
    return { value, keyVersion };
  }

  return {
    async list(teamId: TeamId, membershipId?: MembershipId) {
      const stmt = membershipId
        ? db
            .prepare(
              "SELECT * FROM profile_fields WHERE team_id = ? AND membership_id = ?",
            )
            .bind(teamId, membershipId)
        : db.prepare("SELECT * FROM profile_fields WHERE team_id = ?").bind(teamId);
      const rows = await stmt.all<ProfileFieldRow>();
      return Promise.all(rows.results.map(decryptRow));
    },

    async upsertField(teamId, field, actorMembershipId, audit) {
      const aad = fieldAad(teamId, field.membershipId, field.field);
      const stored = await encodeForStorage(field.field, aad, field.value);

      // FIX-001: when the prior field was unreadable, `audit.oldValue` is
      // `null` by contract (see update-profile-field.ts) — the domain
      // never had a plaintext to re-encrypt. Preserve the original stored
      // ciphertext + its true key_version instead via a SELECT, which MUST
      // run before the profile_fields UPDATE below overwrites that row.
      const auditStatement = audit.oldValueUnreadable
        ? auditInsertPreservingOldValueStatement(db, {
            id: idGen.newId(),
            teamId,
            actorMembershipId,
            targetMembershipId: field.membershipId,
            membershipId: field.membershipId,
            field: audit.field,
            newValue: toBlob(stored.value),
            keyVersion: stored.keyVersion,
            createdAt: clock.now(),
          })
        : await (async () => {
            const oldStored =
              audit.oldValue === null
                ? null
                : await encodeForStorage(field.field, aad, audit.oldValue);
            return auditInsertStatement(db, {
              id: idGen.newId(),
              teamId,
              actorMembershipId,
              targetMembershipId: field.membershipId,
              field: audit.field,
              oldValue: oldStored ? toBlob(oldStored.value) : null,
              oldKeyVersion: oldStored ? oldStored.keyVersion : null,
              newValue: toBlob(stored.value),
              keyVersion: stored.keyVersion,
              createdAt: clock.now(),
            });
          })();

      await db.batch([
        auditStatement,
        db
          .prepare(
            `INSERT INTO profile_fields (team_id, membership_id, field, value, key_version, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT (team_id, membership_id, field)
             DO UPDATE SET value = excluded.value, key_version = excluded.key_version, updated_at = excluded.updated_at`,
          )
          .bind(
            teamId,
            field.membershipId,
            field.field,
            toBlob(stored.value),
            stored.keyVersion,
            field.updatedAt,
          ),
      ]);
    },
  };
}
