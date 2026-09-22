import { FieldUnreadableError } from "../../domain/errors";
import type { FieldCipher } from "../../domain/ports";
import type { KeyRing } from "./key-ring";

// AES-GCM-256, 12-byte random IV, AAD binds the ciphertext to its
// table+team+row+field (design.md "Ciphertext binding"). Stored `value` is
// `iv || ciphertext-with-auth-tag` so a single BLOB column round-trips.

const IV_BYTES = 12;
const ALGORITHM = "AES-GCM";

export function createAesGcmCipher(keyRing: KeyRing): FieldCipher {
  const importedKeys = new Map<number, Promise<CryptoKey>>();

  function importKey(version: number): Promise<CryptoKey> {
    const cached = importedKeys.get(version);
    if (cached) return cached;

    const raw = keyRing.keys.get(version);
    if (!raw) {
      throw new FieldUnreadableError(`Unknown key version ${version}`);
    }

    const promise = crypto.subtle.importKey(
      "raw",
      raw,
      ALGORITHM,
      false,
      ["encrypt", "decrypt"],
    );
    importedKeys.set(version, promise);
    return promise;
  }

  return {
    async encrypt(plain, aad) {
      const keyVersion = keyRing.active;
      const key = await importKey(keyVersion);
      const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));

      const ciphertext = new Uint8Array(
        await crypto.subtle.encrypt(
          { name: ALGORITHM, iv, additionalData: new TextEncoder().encode(aad) },
          key,
          new TextEncoder().encode(plain),
        ),
      );

      const value = new Uint8Array(IV_BYTES + ciphertext.length);
      value.set(iv, 0);
      value.set(ciphertext, IV_BYTES);
      return { value, keyVersion };
    },

    async decrypt(value, keyVersion, aad) {
      const key = await importKey(keyVersion);
      const iv = value.slice(0, IV_BYTES);
      const ciphertext = value.slice(IV_BYTES);

      try {
        const plainBytes = await crypto.subtle.decrypt(
          { name: ALGORITHM, iv, additionalData: new TextEncoder().encode(aad) },
          key,
          ciphertext,
        );
        return new TextDecoder().decode(plainBytes);
      } catch {
        // Wrong AAD (moved tenant/row/field), corrupted ciphertext, or a
        // truncated `value` all surface as a GCM auth-tag failure here —
        // never leak WebCrypto's internal error, and never return partial
        // plaintext (design.md "PII Never Logged" — no raw error detail).
        throw new FieldUnreadableError(
          "Ciphertext could not be decrypted (wrong key, AAD, or corrupted value)",
        );
      }
    },
  };
}
