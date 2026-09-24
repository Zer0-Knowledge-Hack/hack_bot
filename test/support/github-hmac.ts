// Shared test helper (READ-002 correction): both
// test/adapters/github/signature.test.ts and test/http/github-webhook.test.ts
// need to compute the exact `X-Hub-Signature-256` hex digest a real GitHub
// delivery would send, so the duplicate was extracted here instead of
// copy-pasted in each file.
export async function signHex(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
