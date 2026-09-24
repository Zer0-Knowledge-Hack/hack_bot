import { ConfigError } from "../../config-error";
import { timingSafeCompare } from "../crypto/timing-safe-compare";

// design.md "Signature check": validate the header shape, HMAC-SHA256 over
// the raw body bytes with the global secret, then a constant-time compare —
// all before JSON.parse (src/index.ts calls this before ever parsing the
// body). An empty or missing secret is a config error, never a verify
// against an empty key (that would make every signature "wrong" for the
// wrong reason and could mask a deploy-before-secret-is-set state as a
// generic 401 instead of a loud, redeliverable 500).
const SIGNATURE_PATTERN = /^sha256=[0-9a-f]{64}$/;

export async function verifyGithubSignature(
  rawBody: ArrayBuffer,
  signatureHeader: string | null | undefined,
  secret: string | null | undefined,
): Promise<boolean> {
  if (!secret) {
    throw new ConfigError("GITHUB_WEBHOOK_SECRET is not configured");
  }
  if (!signatureHeader || !SIGNATURE_PATTERN.test(signatureHeader)) {
    return false;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, rawBody);
  const expectedHeader = `sha256=${toHex(digest)}`;

  // READ-001: shared with the Telegram route's secret check
  // (src/index.ts) via timingSafeCompare — length-checked before the
  // constant-time compare. The regex above already guarantees
  // signatureHeader is exactly 7 + 64 chars when it got this far, so the
  // length check inside timingSafeCompare is a defensive re-check, not a
  // behavior the regex could actually violate.
  return timingSafeCompare(signatureHeader, expectedHeader);
}

function toHex(digest: ArrayBuffer): string {
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
