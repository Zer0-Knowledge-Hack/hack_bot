import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createD1ProfileRepo } from "../../../src/adapters/d1/profile-repo";
import { createAesGcmCipher } from "../../../src/adapters/crypto/aes-gcm-cipher";
import { parseKeyRing } from "../../../src/adapters/crypto/key-ring";
import { asMembershipId, asTeamId } from "../../../src/domain/ids";
import { fakeClock } from "../../fakes";

const KEY_V1 = Buffer.alloc(32, 9).toString("base64");

function makeRepo() {
  const keyRing = parseKeyRing(JSON.stringify({ active: 1, keys: { "1": KEY_V1 } }));
  const cipher = createAesGcmCipher(keyRing);
  return createD1ProfileRepo(
    env.DB,
    { newId: () => crypto.randomUUID() },
    fakeClock(),
    cipher,
  );
}

async function seedTeamAndMembership(teamId: string, chatId: number, membershipId: string) {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO teams (id, telegram_chat_id, created_at) VALUES (?, ?, ?)",
    ).bind(teamId, chatId, 0),
    env.DB.prepare(
      "INSERT INTO members (id, telegram_user_id, created_at) VALUES (?, ?, ?)",
    ).bind(`member-${membershipId}`, chatId * 1000, 0),
    env.DB.prepare(
      "INSERT INTO memberships (id, team_id, member_id, role, joined_at) VALUES (?, ?, ?, 'member', ?)",
    ).bind(membershipId, teamId, `member-${membershipId}`, 0),
  ]);
}

describe("createD1ProfileRepo — encryption at rest (design.md pii-protection)", () => {
  it("stores full_name as ciphertext (raw row is not the plaintext) and decrypts back via list()", async () => {
    const teamId = "team-pii-1";
    const membershipId = "m-pii-1";
    await seedTeamAndMembership(teamId, 100, membershipId);
    const repo = makeRepo();

    await repo.upsertField(
      asTeamId(teamId),
      {
        teamId: asTeamId(teamId),
        membershipId: asMembershipId(membershipId),
        field: "full_name",
        value: "Ada Lovelace",
        keyVersion: null,
        updatedAt: 1,
      },
      asMembershipId(membershipId),
      { field: "full_name", oldValue: null, newValue: "Ada Lovelace", keyVersion: null },
    );

    const raw = await env.DB.prepare(
      "SELECT value, key_version FROM profile_fields WHERE team_id = ? AND membership_id = ? AND field = 'full_name'",
    )
      .bind(teamId, membershipId)
      .first<{ value: ArrayBuffer; key_version: number }>();
    const rawText = new TextDecoder().decode(new Uint8Array(raw!.value));
    expect(rawText).not.toContain("Ada Lovelace");
    expect(raw!.key_version).toBe(1);

    const [decrypted] = await repo.list(asTeamId(teamId), asMembershipId(membershipId));
    expect(decrypted?.value).toBe("Ada Lovelace");
  });

  it("stores github_username as plaintext with NULL key_version", async () => {
    const teamId = "team-pii-2";
    const membershipId = "m-pii-2";
    await seedTeamAndMembership(teamId, 200, membershipId);
    const repo = makeRepo();

    await repo.upsertField(
      asTeamId(teamId),
      {
        teamId: asTeamId(teamId),
        membershipId: asMembershipId(membershipId),
        field: "github_username",
        value: "octocat",
        keyVersion: null,
        updatedAt: 1,
      },
      asMembershipId(membershipId),
      { field: "github_username", oldValue: null, newValue: "octocat", keyVersion: null },
    );

    const raw = await env.DB.prepare(
      "SELECT value, key_version FROM profile_fields WHERE team_id = ? AND membership_id = ? AND field = 'github_username'",
    )
      .bind(teamId, membershipId)
      .first<{ value: ArrayBuffer; key_version: number | null }>();
    expect(new TextDecoder().decode(new Uint8Array(raw!.value))).toBe("octocat");
    expect(raw!.key_version).toBeNull();
  });

  it("stores audit old/new values of an encrypted field as ciphertext, never plaintext", async () => {
    const teamId = "team-pii-3";
    const membershipId = "m-pii-3";
    await seedTeamAndMembership(teamId, 300, membershipId);
    const repo = makeRepo();

    await repo.upsertField(
      asTeamId(teamId),
      {
        teamId: asTeamId(teamId),
        membershipId: asMembershipId(membershipId),
        field: "emails",
        value: "new@example.com",
        keyVersion: null,
        updatedAt: 1,
      },
      asMembershipId(membershipId),
      {
        field: "emails",
        oldValue: "old@example.com",
        newValue: "new@example.com",
        keyVersion: null,
      },
    );

    const audit = await env.DB.prepare(
      "SELECT old_value, new_value, key_version FROM audit_log WHERE team_id = ? AND field = 'emails'",
    )
      .bind(teamId)
      .first<{ old_value: ArrayBuffer; new_value: ArrayBuffer; key_version: number }>();
    expect(new TextDecoder().decode(new Uint8Array(audit!.old_value))).not.toContain(
      "old@example.com",
    );
    expect(new TextDecoder().decode(new Uint8Array(audit!.new_value))).not.toContain(
      "new@example.com",
    );
    expect(audit!.key_version).toBe(1);
  });

  it("list() never returns a profile field from a different team (cross-tenant isolation)", async () => {
    const membershipIdA = "m-pii-cross-a";
    const membershipIdB = "m-pii-cross-b";
    await seedTeamAndMembership("team-pii-cross-a", 400, membershipIdA);
    await seedTeamAndMembership("team-pii-cross-b", 401, membershipIdB);
    const repo = makeRepo();

    await repo.upsertField(
      asTeamId("team-pii-cross-a"),
      {
        teamId: asTeamId("team-pii-cross-a"),
        membershipId: asMembershipId(membershipIdA),
        field: "github_username",
        value: "team-a-user",
        keyVersion: null,
        updatedAt: 1,
      },
      asMembershipId(membershipIdA),
      { field: "github_username", oldValue: null, newValue: "team-a-user", keyVersion: null },
    );

    const crossTenantRead = await repo.list(
      asTeamId("team-pii-cross-b"),
      asMembershipId(membershipIdA),
    );
    expect(crossTenantRead).toHaveLength(0);
  });

  it("isolates a decrypt failure to the affected field: other fields still return, the broken one is marked unreadable", async () => {
    const teamId = "team-pii-4";
    const membershipId = "m-pii-4";
    await seedTeamAndMembership(teamId, 500, membershipId);
    const repo = makeRepo();

    await repo.upsertField(
      asTeamId(teamId),
      {
        teamId: asTeamId(teamId),
        membershipId: asMembershipId(membershipId),
        field: "github_username",
        value: "octocat",
        keyVersion: null,
        updatedAt: 1,
      },
      asMembershipId(membershipId),
      { field: "github_username", oldValue: null, newValue: "octocat", keyVersion: null },
    );

    // Corrupted row inserted directly: an unknown key_version makes
    // decrypt() fail deterministically with FieldUnreadableError, without
    // relying on ciphertext-tamper mechanics already covered elsewhere.
    await env.DB.prepare(
      "INSERT INTO profile_fields (team_id, membership_id, field, value, key_version, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(
        teamId,
        membershipId,
        "full_name",
        new Uint8Array(16).fill(7),
        99,
        1,
      )
      .run();

    const result = await repo.list(asTeamId(teamId), asMembershipId(membershipId));

    expect(result).toHaveLength(2);
    const goodField = result.find((f) => f.field === "github_username");
    expect(goodField?.value).toBe("octocat");
    expect(goodField?.unreadable).toBeUndefined();
    const badField = result.find((f) => f.field === "full_name");
    expect(badField?.unreadable).toBe(true);
    expect(badField?.value).toBe("");
  });

  it("FIX-001: preserves the original ciphertext + key_version of an unreadable field as the audit old value, instead of fabricating one", async () => {
    const teamId = "team-pii-5";
    const membershipId = "m-pii-5";
    await seedTeamAndMembership(teamId, 600, membershipId);
    const repo = makeRepo();

    // Corrupted row inserted directly with an unknown key_version (99) so
    // it is undecryptable and would surface as `unreadable: true` via
    // list() (RES-001). Its exact bytes are the "original ciphertext" we
    // must preserve.
    const originalCiphertext = new Uint8Array(16).fill(3);
    await env.DB.prepare(
      "INSERT INTO profile_fields (team_id, membership_id, field, value, key_version, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(teamId, membershipId, "full_name", originalCiphertext, 99, 1)
      .run();

    await repo.upsertField(
      asTeamId(teamId),
      {
        teamId: asTeamId(teamId),
        membershipId: asMembershipId(membershipId),
        field: "full_name",
        value: "New Name",
        keyVersion: null,
        updatedAt: 2,
      },
      asMembershipId(membershipId),
      {
        field: "full_name",
        oldValue: null,
        oldValueUnreadable: true,
        newValue: "New Name",
        keyVersion: null,
      },
    );

    const audit = await env.DB.prepare(
      "SELECT old_value, old_key_version, new_value, key_version FROM audit_log WHERE team_id = ? AND field = 'full_name'",
    )
      .bind(teamId)
      .first<{
        old_value: ArrayBuffer;
        old_key_version: number;
        new_value: ArrayBuffer;
        key_version: number;
      }>();

    expect(new Uint8Array(audit!.old_value)).toEqual(originalCiphertext);
    expect(audit!.old_key_version).toBe(99);

    // The new value must remain decryptable with the active key.
    const [current] = await repo.list(asTeamId(teamId), asMembershipId(membershipId));
    expect(current?.value).toBe("New Name");
    expect(current?.unreadable).toBeUndefined();
  });

  it("FIX-001: ProfileRepo.list re-throws a non-FieldUnreadableError from the cipher instead of swallowing it", async () => {
    const teamId = "team-pii-6";
    const membershipId = "m-pii-6";
    await seedTeamAndMembership(teamId, 700, membershipId);

    await env.DB.prepare(
      "INSERT INTO profile_fields (team_id, membership_id, field, value, key_version, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(teamId, membershipId, "full_name", new Uint8Array(16).fill(1), 1, 1)
      .run();

    const throwingCipher = {
      encrypt: async () => {
        throw new Error("should not be called");
      },
      decrypt: async () => {
        throw new Error("boom: not a FieldUnreadableError");
      },
    };
    const repo = createD1ProfileRepo(
      env.DB,
      { newId: () => crypto.randomUUID() },
      fakeClock(),
      throwingCipher,
    );

    await expect(
      repo.list(asTeamId(teamId), asMembershipId(membershipId)),
    ).rejects.toThrow("boom: not a FieldUnreadableError");
  });
});
