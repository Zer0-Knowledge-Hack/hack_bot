import { describe, expect, it } from "vitest";
import { ConfigError } from "../../../src/config-error";
import { verifyGithubSignature } from "../../../src/adapters/github/signature";
import { signHex } from "../../support/github-hmac";

// github-webhook spec: "HMAC Signature Verification Over Raw Body" — HMAC-SHA256
// over the raw bytes, constant-time compare, secret misconfiguration is a
// ConfigError (never a verify-against-empty-key), all before JSON.parse.

const SECRET = "github-webhook-secret-value";

function bodyBytes(body: string): ArrayBuffer {
  return new TextEncoder().encode(body).buffer as ArrayBuffer;
}

describe("verifyGithubSignature", () => {
  const body = JSON.stringify({ zen: "test", hook_id: 1 });

  it("rejects when the signature header is missing", async () => {
    await expect(
      verifyGithubSignature(bodyBytes(body), undefined, SECRET),
    ).resolves.toBe(false);
  });

  it("rejects a signature computed from a different secret", async () => {
    const wrongSig = `sha256=${await signHex(body, "a-different-secret-entirely")}`;
    await expect(verifyGithubSignature(bodyBytes(body), wrongSig, SECRET)).resolves.toBe(
      false,
    );
  });

  it("rejects a same-length-but-wrong-content signature (constant-time compare path)", async () => {
    const rightHex = await signHex(body, SECRET);
    const flippedHex = (rightHex[0] === "0" ? "1" : "0") + rightHex.slice(1);
    await expect(
      verifyGithubSignature(bodyBytes(body), `sha256=${flippedHex}`, SECRET),
    ).resolves.toBe(false);
  });

  it("rejects a malformed header (wrong prefix/shape, never even hashed)", async () => {
    await expect(
      verifyGithubSignature(bodyBytes(body), "sha1=deadbeef", SECRET),
    ).resolves.toBe(false);
  });

  it("accepts a signature matching the raw body under the configured secret", async () => {
    const sig = `sha256=${await signHex(body, SECRET)}`;
    await expect(verifyGithubSignature(bodyBytes(body), sig, SECRET)).resolves.toBe(true);
  });

  it("throws ConfigError instead of verifying when the secret is an empty string", async () => {
    await expect(
      verifyGithubSignature(bodyBytes(body), "sha256=anything", ""),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it("throws ConfigError instead of verifying when the secret is undefined", async () => {
    await expect(
      verifyGithubSignature(
        bodyBytes(body),
        "sha256=anything",
        undefined as unknown as string,
      ),
    ).rejects.toBeInstanceOf(ConfigError);
  });
});
