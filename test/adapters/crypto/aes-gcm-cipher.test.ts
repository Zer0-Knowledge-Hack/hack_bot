import { describe, expect, it } from "vitest";
import { FieldUnreadableError } from "../../../src/domain/errors";
import { createAesGcmCipher } from "../../../src/adapters/crypto/aes-gcm-cipher";
import { parseKeyRing } from "../../../src/adapters/crypto/key-ring";
import { ConfigError } from "../../../src/config-error";

// 32 raw bytes, base64-encoded — matches PII_KEYRING's documented format
// (.dev.vars.example: `{"active":1,"keys":{"1":"<base64 32B key>"}}`).
const KEY_V1 = Buffer.alloc(32, 1).toString("base64");
const KEY_V2 = Buffer.alloc(32, 2).toString("base64");

describe("createAesGcmCipher (WebCrypto AES-GCM)", () => {
  it("round-trips a plaintext value under the active key", async () => {
    const keyRing = parseKeyRing(
      JSON.stringify({ active: 1, keys: { "1": KEY_V1 } }),
    );
    const cipher = createAesGcmCipher(keyRing);

    const { value, keyVersion } = await cipher.encrypt(
      "grace@example.com",
      "profile_fields|team-1|membership-1|emails",
    );
    const plain = await cipher.decrypt(
      value,
      keyVersion,
      "profile_fields|team-1|membership-1|emails",
    );

    expect(keyVersion).toBe(1);
    expect(plain).toBe("grace@example.com");
  });

  it("round-trips a different value to prove it is not a hardcoded return", async () => {
    const keyRing = parseKeyRing(
      JSON.stringify({ active: 1, keys: { "1": KEY_V1 } }),
    );
    const cipher = createAesGcmCipher(keyRing);

    const { value, keyVersion } = await cipher.encrypt(
      "Ada Lovelace",
      "profile_fields|team-2|membership-9|full_name",
    );
    const plain = await cipher.decrypt(
      value,
      keyVersion,
      "profile_fields|team-2|membership-9|full_name",
    );

    expect(plain).toBe("Ada Lovelace");
  });

  it("rejects decryption when the AAD does not match (ciphertext moved to another row/tenant)", async () => {
    const keyRing = parseKeyRing(
      JSON.stringify({ active: 1, keys: { "1": KEY_V1 } }),
    );
    const cipher = createAesGcmCipher(keyRing);

    const { value, keyVersion } = await cipher.encrypt(
      "secret@team-a.example",
      "profile_fields|team-a|membership-1|emails",
    );

    await expect(
      cipher.decrypt(
        value,
        keyVersion,
        "profile_fields|team-b|membership-1|emails",
      ),
    ).rejects.toThrow(FieldUnreadableError);
  });

  it("rejects decryption for an unknown key version", async () => {
    const keyRing = parseKeyRing(
      JSON.stringify({ active: 1, keys: { "1": KEY_V1 } }),
    );
    const cipher = createAesGcmCipher(keyRing);

    await expect(
      cipher.decrypt(new Uint8Array(28), 99, "profile_fields|t|m|full_name"),
    ).rejects.toThrow(FieldUnreadableError);
  });

  it("rejects decryption of a tampered (bit-flipped) ciphertext", async () => {
    const keyRing = parseKeyRing(
      JSON.stringify({ active: 1, keys: { "1": KEY_V1 } }),
    );
    const cipher = createAesGcmCipher(keyRing);
    const aad = "profile_fields|team-1|membership-1|full_name";
    const { value, keyVersion } = await cipher.encrypt("Grace Hopper", aad);

    const tampered = new Uint8Array(value);
    // Flip one bit inside the ciphertext (after the 12-byte IV prefix) —
    // GCM's auth tag MUST catch this, never silently return corrupted text.
    const lastIndex = tampered.length - 1;
    tampered.set([tampered[lastIndex]! ^ 0xff], lastIndex);

    await expect(cipher.decrypt(tampered, keyVersion, aad)).rejects.toThrow(
      FieldUnreadableError,
    );
  });

  it("rejects decryption of a truncated ciphertext", async () => {
    const keyRing = parseKeyRing(
      JSON.stringify({ active: 1, keys: { "1": KEY_V1 } }),
    );
    const cipher = createAesGcmCipher(keyRing);
    const aad = "profile_fields|team-1|membership-1|full_name";
    const { value, keyVersion } = await cipher.encrypt("Grace Hopper", aad);

    const truncated = value.slice(0, value.length - 5);

    await expect(cipher.decrypt(truncated, keyVersion, aad)).rejects.toThrow(
      FieldUnreadableError,
    );
  });

  it("rejects decryption when the key version is present in the ring but wrong for this value", async () => {
    const keyRing = parseKeyRing(
      JSON.stringify({ active: 1, keys: { "1": KEY_V1, "2": KEY_V2 } }),
    );
    const cipher = createAesGcmCipher(keyRing);
    const aad = "profile_fields|team-1|membership-1|full_name";
    const { value } = await cipher.encrypt("Grace Hopper", aad);

    // Value was encrypted under key version 1 (the active key at encrypt
    // time); claiming it was encrypted under version 2 (present, but wrong
    // for THIS ciphertext) must still fail closed.
    await expect(cipher.decrypt(value, 2, aad)).rejects.toThrow(FieldUnreadableError);
  });

  it("still decrypts a value written under an old key version after rotation", async () => {
    const keyRingBeforeRotation = parseKeyRing(
      JSON.stringify({ active: 1, keys: { "1": KEY_V1 } }),
    );
    const cipherBeforeRotation = createAesGcmCipher(keyRingBeforeRotation);
    const { value, keyVersion } = await cipherBeforeRotation.encrypt(
      "old-key-value",
      "profile_fields|team-1|membership-1|full_name",
    );

    // `active` moves to 2, but key 1 stays in the ring (design.md "Rotation").
    const keyRingAfterRotation = parseKeyRing(
      JSON.stringify({ active: 2, keys: { "1": KEY_V1, "2": KEY_V2 } }),
    );
    const cipherAfterRotation = createAesGcmCipher(keyRingAfterRotation);

    const plain = await cipherAfterRotation.decrypt(
      value,
      keyVersion,
      "profile_fields|team-1|membership-1|full_name",
    );

    expect(plain).toBe("old-key-value");
  });

  it("encrypts new values under the active (rotated) key version", async () => {
    const keyRing = parseKeyRing(
      JSON.stringify({ active: 2, keys: { "1": KEY_V1, "2": KEY_V2 } }),
    );
    const cipher = createAesGcmCipher(keyRing);

    const { keyVersion } = await cipher.encrypt(
      "new-key-value",
      "profile_fields|team-1|membership-1|full_name",
    );

    expect(keyVersion).toBe(2);
  });
});

describe("parseKeyRing (PII_KEYRING secret parsing, fail-closed)", () => {
  it("throws when the secret is missing", () => {
    expect(() => parseKeyRing(undefined)).toThrow();
  });

  it("throws when the secret is not valid JSON", () => {
    expect(() => parseKeyRing("not-json{")).toThrow();
  });

  it("throws when the active key has no matching entry", () => {
    expect(() =>
      parseKeyRing(JSON.stringify({ active: 5, keys: { "1": KEY_V1 } })),
    ).toThrow();
  });

  it("throws when a key does not decode to 32 bytes", () => {
    const shortKey = Buffer.alloc(16, 7).toString("base64");
    expect(() =>
      parseKeyRing(JSON.stringify({ active: 1, keys: { "1": shortKey } })),
    ).toThrow();
  });

  it("parses a well-formed keyring with multiple key versions", () => {
    const keyRing = parseKeyRing(
      JSON.stringify({ active: 2, keys: { "1": KEY_V1, "2": KEY_V2 } }),
    );

    expect(keyRing.active).toBe(2);
    expect(keyRing.keys.size).toBe(2);
  });
});

// Malformed-input coverage at the PII_KEYRING trust boundary. Every failure
// MUST be a ConfigError (the only error type whose message the webhook
// boundary logs, see src/index.ts), and that message MUST NOT echo key
// material or any other part of the raw secret.
describe("parseKeyRing — malformed PII_KEYRING input", () => {
  const LEAK_MARKER = "leak-marker-SECRET";

  it.each([
    ["a raw base64 key instead of the JSON keyring", KEY_V1],
    ["whitespace only", "   "],
    ["JSON null", "null"],
    ["a JSON array", JSON.stringify([KEY_V1])],
    ["a JSON number", "42"],
    ["a JSON string", JSON.stringify(KEY_V1)],
    ["missing active", JSON.stringify({ keys: { "1": KEY_V1 } })],
    ["active as a string", JSON.stringify({ active: "1", keys: { "1": KEY_V1 } })],
    ["keys null", JSON.stringify({ active: 1, keys: null })],
    ["keys as a string", JSON.stringify({ active: 1, keys: KEY_V1 })],
    ["a non-integer version key", JSON.stringify({ active: 1, keys: { "1": KEY_V1, [LEAK_MARKER]: KEY_V2 } })],
    ["a non-string key value", JSON.stringify({ active: 1, keys: { "1": 12345 } })],
    ["a key that is not 32 bytes", JSON.stringify({ active: 1, keys: { "1": Buffer.alloc(31, 1).toString("base64") } })],
    ["an active version with no key entry", JSON.stringify({ active: 2, keys: { "1": KEY_V1 } })],
  ])("throws a ConfigError that does not echo the secret for %s", (_label, raw) => {
    let thrown: unknown;
    try {
      parseKeyRing(raw);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(ConfigError);
    const message = (thrown as Error).message;
    expect(message).toMatch(/PII_KEYRING/);
    expect(message).not.toContain(KEY_V1);
    expect(message).not.toContain(KEY_V2);
    expect(message).not.toContain(LEAK_MARKER);
  });
});
