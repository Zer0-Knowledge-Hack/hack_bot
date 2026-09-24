import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import app from "../../src/index";
import type { Env } from "../../src/index";
import { signHex } from "../support/github-hmac";

// github-webhook spec: HMAC gate, ping/malformed/unsupported status policy,
// and the production-safety requirement that a missing/empty
// GITHUB_WEBHOOK_SECRET fails every request closed (500), never open.
// Event mapping/routing/Telegram delivery are out of scope for this PR
// (Phase 4) — every signature-verified, well-formed, non-ping event is
// acknowledged with 200 as an "unsupported for now" placeholder.

const GITHUB_WEBHOOK_SECRET = (env as unknown as { GITHUB_WEBHOOK_SECRET: string })
  .GITHUB_WEBHOOK_SECRET;

function post(body: string, headers: Record<string, string> = {}, envOverride: unknown = env) {
  return app.request(
    "/github/webhook",
    {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
    },
    envOverride as Env,
  );
}

async function signedPost(
  body: string,
  githubEvent: string,
  envOverride: unknown = env,
  secret: string = GITHUB_WEBHOOK_SECRET,
) {
  const signature = `sha256=${await signHex(body, secret)}`;
  return post(
    body,
    { "X-Hub-Signature-256": signature, "X-GitHub-Event": githubEvent },
    envOverride,
  );
}

describe("POST /github/webhook — signature gate", () => {
  it("rejects a request with no signature header", async () => {
    const res = await post(JSON.stringify({ zen: "z" }), { "X-GitHub-Event": "ping" });
    expect(res.status).toBe(401);
  });

  it("rejects a request signed with a different secret", async () => {
    const res = await signedPost(
      JSON.stringify({ zen: "z" }),
      "ping",
      env,
      "a-totally-different-secret",
    );
    expect(res.status).toBe(401);
  });

  it("rejects a same-length-but-wrong-content signature", async () => {
    const body = JSON.stringify({ zen: "z" });
    const rightHex = await signHex(body, GITHUB_WEBHOOK_SECRET);
    const flippedHex = (rightHex[0] === "0" ? "1" : "0") + rightHex.slice(1);
    const res = await post(body, {
      "X-Hub-Signature-256": `sha256=${flippedHex}`,
      "X-GitHub-Event": "ping",
    });
    expect(res.status).toBe(401);
  });
});

describe("POST /github/webhook — status policy", () => {
  it("returns 200 for a signature-verified ping without routing", async () => {
    const res = await signedPost(JSON.stringify({ zen: "z", hook_id: 1 }), "ping");
    expect(res.status).toBe(200);
  });

  it("returns 200 for a signature-verified but malformed JSON body", async () => {
    const body = "{not json";
    const signature = `sha256=${await signHex(body, GITHUB_WEBHOOK_SECRET)}`;
    const res = await post(body, {
      "X-Hub-Signature-256": signature,
      "X-GitHub-Event": "ping",
    });
    expect(res.status).toBe(200);
  });

  it("returns 200 for a signature-verified non-object JSON body (e.g. an array)", async () => {
    const res = await signedPost(JSON.stringify([1, 2, 3]), "ping");
    expect(res.status).toBe(200);
  });

  it("returns 200 for a signature-verified event outside the (not yet wired) supported set", async () => {
    const res = await signedPost(
      JSON.stringify({ action: "opened", repository: { full_name: "o/r" } }),
      "pull_request",
    );
    expect(res.status).toBe(200);
  });

  it("logs the not-yet-routed event through the safe logger (RES-002, design.md:27 'unsupported event: 200, logged')", async () => {
    const logs: string[] = [];
    const consoleSpy = vi.spyOn(console, "log").mockImplementation((msg) => {
      logs.push(String(msg));
    });

    const res = await signedPost(
      JSON.stringify({ action: "opened", repository: { full_name: "o/r" } }),
      "pull_request",
    );

    expect(res.status).toBe(200);
    const entry = logs.map((l) => JSON.parse(l)).find((e) => e.event === "github-webhook");
    expect(entry).toEqual({
      event: "github-webhook",
      outcome: "ok",
      reason: "ignored:not-yet-routed",
    });

    consoleSpy.mockRestore();
  });
});

describe("POST /github/webhook — unreadable raw body (RES-001, correction 2)", () => {
  it("returns 500 (transient/unauthenticated transport failure, not a malformed-content case) and logs only allowlisted fields", async () => {
    const logs: string[] = [];
    const consoleSpy = vi.spyOn(console, "log").mockImplementation((msg) => {
      logs.push(String(msg));
    });

    const brokenStream = new ReadableStream({
      start(controller) {
        controller.error(new Error("stream broken — should never appear in logs"));
      },
    });
    const req = new Request("https://example.com/github/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: brokenStream,
      duplex: "half",
    } as RequestInit);

    const res = await app.request(req, undefined, env as unknown as Env);

    expect(res.status).toBe(500);
    const entry = logs.map((l) => JSON.parse(l)).find((e) => e.event === "github-webhook");
    expect(entry).toEqual({
      event: "github-webhook",
      outcome: "error",
      errorCode: "Error",
    });
    expect(logs.join("\n")).not.toContain("stream broken");

    consoleSpy.mockRestore();
  });
});

describe("POST /github/webhook — fails closed when GITHUB_WEBHOOK_SECRET is unset", () => {
  it("returns 500, never 200 or 401, for an unsigned request", async () => {
    const res = await post(
      JSON.stringify({ zen: "z" }),
      { "X-GitHub-Event": "ping" },
      { ...env, GITHUB_WEBHOOK_SECRET: "" },
    );
    expect(res.status).toBe(500);
  });

  it("returns 500 even when the request carries a well-formed signature header", async () => {
    // A well-formed sha256=<64 hex> header, signed under the real test
    // secret — the point is that the ConfigError check on the unset/empty
    // secret must fire before any signature comparison, so this must still
    // be 500, never a 401 (an empty secret can never make a signature
    // "valid" and get treated as authenticated).
    const body = JSON.stringify({ zen: "z" });
    const signature = `sha256=${await signHex(body, GITHUB_WEBHOOK_SECRET)}`;
    const res = await post(
      body,
      { "X-Hub-Signature-256": signature, "X-GitHub-Event": "ping" },
      { ...env, GITHUB_WEBHOOK_SECRET: "" },
    );
    expect(res.status).toBe(500);
  });

  it("never crashes: always returns a well-formed HTTP response", async () => {
    const res = await post(
      JSON.stringify({ zen: "z" }),
      {},
      { ...env, GITHUB_WEBHOOK_SECRET: "" },
    );
    expect(res.status).toBe(500);
    await expect(res.text()).resolves.toBeTypeOf("string");
  });

  it("does not affect the Telegram webhook route", async () => {
    const res = await app.request(
      "/telegram/webhook",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Telegram-Bot-Api-Secret-Token": (env as unknown as { WEBHOOK_SECRET: string })
            .WEBHOOK_SECRET,
        },
        body: JSON.stringify({ update_id: 1 }),
      },
      { ...env, GITHUB_WEBHOOK_SECRET: "" } as Env,
    );
    expect(res.status).toBe(200);
  });

  it("does not affect /health", async () => {
    const res = await app.request(
      "/health",
      { method: "GET" },
      { ...env, GITHUB_WEBHOOK_SECRET: "" } as Env,
    );
    expect(res.status).toBe(200);
  });
});

describe("POST /github/webhook — never logs payload, signature or secret", () => {
  it("logs no line containing the raw body, the signature header, or the secret", async () => {
    const logs: string[] = [];
    const consoleSpy = vi.spyOn(console, "log").mockImplementation((msg) => {
      logs.push(String(msg));
    });

    const body = JSON.stringify({ zen: "leak-marker-zen-value", hook_id: 999 });
    const signature = `sha256=${await signHex(body, GITHUB_WEBHOOK_SECRET)}`;
    await post(body, { "X-Hub-Signature-256": signature, "X-GitHub-Event": "push" });
    await post("{not json", { "X-Hub-Signature-256": signature, "X-GitHub-Event": "ping" });
    await post(body, { "X-Hub-Signature-256": `sha256=${"0".repeat(64)}` });

    const logged = logs.join("\n");
    expect(logged).not.toContain("leak-marker-zen-value");
    expect(logged).not.toContain(signature);
    expect(logged).not.toContain(GITHUB_WEBHOOK_SECRET);

    consoleSpy.mockRestore();
  });
});
