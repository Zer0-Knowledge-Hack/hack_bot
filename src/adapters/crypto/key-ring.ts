// Parses the `PII_KEYRING` secret (design.md "Key ring"):
//   {"active":<version>,"keys":{"<version>":"<base64 32-byte key>"}}
// Fails closed (throws) on anything missing or malformed — a broken keyring
// must never silently fall back to plaintext or a wrong key. Every failure
// is a ConfigError whose message is logged as-is, so messages only ever
// interpolate already-validated numbers, never raw secret content.

import { ConfigError } from "../../config-error";

const KEY_BYTES = 32;

export interface KeyRing {
  active: number;
  keys: Map<number, Uint8Array>;
}

export function parseKeyRing(raw: string | undefined): KeyRing {
  if (!raw || raw.trim() === "") {
    throw new ConfigError("PII_KEYRING secret is missing");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigError("PII_KEYRING secret is not valid JSON");
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { active?: unknown }).active !== "number" ||
    typeof (parsed as { keys?: unknown }).keys !== "object" ||
    (parsed as { keys?: unknown }).keys === null
  ) {
    throw new ConfigError(
      'PII_KEYRING secret must have the shape {"active":N,"keys":{"N":"<base64 32B>"}}',
    );
  }

  const { active, keys: rawKeys } = parsed as {
    active: number;
    keys: Record<string, unknown>;
  };

  const keys = new Map<number, Uint8Array>();
  for (const [versionText, base64Key] of Object.entries(rawKeys)) {
    const version = Number(versionText);
    if (!Number.isInteger(version) || typeof base64Key !== "string") {
      throw new ConfigError(
        "PII_KEYRING secret has an invalid key entry (version must be an integer, key a base64 string)",
      );
    }
    const bytes = Buffer.from(base64Key, "base64");
    if (bytes.length !== KEY_BYTES) {
      throw new ConfigError(
        `PII_KEYRING secret key version ${version} must decode to ${KEY_BYTES} bytes, got ${bytes.length}`,
      );
    }
    keys.set(version, new Uint8Array(bytes));
  }

  if (!keys.has(active)) {
    throw new ConfigError(
      `PII_KEYRING secret "active" version ${active} has no matching key entry`,
    );
  }

  return { active, keys };
}
