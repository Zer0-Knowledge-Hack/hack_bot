import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import app from "../../src/index";
import type { Env } from "../../src/index";
import { signHex } from "../support/github-hmac";
import { stubTelegramApi } from "../support/telegram-stub";

// PR4 e2e (task 4.6): drives real webhook deliveries through the actual
// route + mapper + composition root (buildGithubRouter) + real D1, with
// only the outbound Telegram API call stubbed — same seam as
// test/http/webhook-e2e.test.ts (READ-002: the stub itself is shared — see
// test/support/telegram-stub.ts; grammY's Api resolves the bare `fetch`
// identifier at construction time; vitest-pool-workers runs the worker in
// the same isolate as the test, so stubbing globalThis.fetch is enough).
// Proves: a linked repo gets an alert delivered; an unlinked/unclaimed repo
// stays silent; a send failure is logged (reason only) and still 2xx; no
// log line ever contains a payload fixture string (spec: github-alerts
// "Delivery Failure Is Logged and Acknowledged", "Allowlisted Fields Only").

const GITHUB_WEBHOOK_SECRET = (env as unknown as { GITHUB_WEBHOOK_SECRET: string })
  .GITHUB_WEBHOOK_SECRET;

afterEach(() => {
  vi.unstubAllGlobals();
});

async function seedTeam(teamId: string, chatId: number) {
  await env.DB.prepare(
    "INSERT INTO teams (id, telegram_chat_id, created_at) VALUES (?, ?, ?)",
  )
    .bind(teamId, chatId, 0)
    .run();
}

async function seedClaim(orgLogin: string, teamId: string) {
  await env.DB.prepare(
    "INSERT INTO github_org_claims (org_login, team_id, created_at) VALUES (?, ?, ?)",
  )
    .bind(orgLogin, teamId, 0)
    .run();
}

async function seedLink(teamId: string, repoFullName: string, orgLogin: string, threadId: number) {
  await env.DB.prepare(
    `INSERT INTO repo_topic_links
      (team_id, repo_full_name, org_login, thread_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(teamId, repoFullName, orgLogin, threadId, 0, 0)
    .run();
}

async function post(body: string, githubEvent: string, envOverride: unknown = env) {
  const signature = `sha256=${await signHex(body, GITHUB_WEBHOOK_SECRET)}`;
  return app.request(
    "/github/webhook",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Hub-Signature-256": signature,
        "X-GitHub-Event": githubEvent,
      },
      body,
    },
    envOverride as Env,
  );
}

function pullRequestPayload(fullName: string, overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    action: "opened",
    number: 42,
    sender: { login: "octocat" },
    repository: { full_name: fullName },
    pull_request: {
      title: "Fix the thing",
      html_url: `https://github.com/${fullName}/pull/42`,
      merged: false,
    },
    ...overrides,
  });
}

describe("POST /github/webhook — end-to-end delivery (PR4, task 4.6)", () => {
  it("delivers an alert to the linked topic for a linked, claimed repo", async () => {
    const calls = stubTelegramApi();
    await seedTeam("gh-e2e-team-1", 700_001);
    await seedClaim("gh-e2e-org-1", "gh-e2e-team-1");
    await seedLink("gh-e2e-team-1", "gh-e2e-org-1/repo-1", "gh-e2e-org-1", 4242);

    const res = await post(pullRequestPayload("gh-e2e-org-1/repo-1"), "pull_request");

    expect(res.status).toBe(200);
    const sendMessageCall = calls.find((c) => c.method === "sendMessage");
    expect(sendMessageCall).toBeTruthy();
    expect(sendMessageCall?.body).toMatchObject({
      chat_id: 700_001,
      message_thread_id: 4242,
    });
    expect((sendMessageCall?.body as { text: string }).text).toContain("Fix the thing");
  });

  it("stays silent for an unlinked repo whose org IS claimed", async () => {
    const calls = stubTelegramApi();
    await seedTeam("gh-e2e-team-2", 700_002);
    await seedClaim("gh-e2e-org-2", "gh-e2e-team-2");
    // No link seeded for gh-e2e-org-2/repo-2.

    const res = await post(pullRequestPayload("gh-e2e-org-2/repo-2"), "pull_request");

    expect(res.status).toBe(200);
    expect(calls.filter((c) => c.method === "sendMessage")).toHaveLength(0);
  });

  it("stays silent for an event whose org has no claim at all, and logs the reason (REL-003)", async () => {
    const logs: string[] = [];
    const consoleSpy = vi.spyOn(console, "log").mockImplementation((msg) => {
      logs.push(String(msg));
    });
    const calls = stubTelegramApi();

    const res = await post(pullRequestPayload("gh-e2e-org-unclaimed/repo-3"), "pull_request");

    expect(res.status).toBe(200);
    expect(calls.filter((c) => c.method === "sendMessage")).toHaveLength(0);
    const entry = logs.map((l) => JSON.parse(l)).find((e) => e.event === "github-webhook");
    expect(entry).toEqual({
      event: "github-webhook",
      outcome: "ok",
      reason: "ignored:unclaimed-org",
    });
    expect(logs.join("\n")).not.toContain("gh-e2e-org-unclaimed/repo-3");

    consoleSpy.mockRestore();
  });

  it("logs the ignored reason (no payload) for an unlinked repo", async () => {
    const logs: string[] = [];
    const consoleSpy = vi.spyOn(console, "log").mockImplementation((msg) => {
      logs.push(String(msg));
    });
    stubTelegramApi();
    await seedTeam("gh-e2e-team-4", 700_004);
    await seedClaim("gh-e2e-org-4", "gh-e2e-team-4");

    await post(pullRequestPayload("gh-e2e-org-4/unlinked-repo"), "pull_request");

    const entry = logs.map((l) => JSON.parse(l)).find((e) => e.event === "github-webhook");
    expect(entry).toEqual({
      event: "github-webhook",
      outcome: "ok",
      reason: "ignored:unlinked-repo",
    });
    // "ignored:unlinked-repo" is itself a fixed, non-sensitive reason
    // string (design.md "Logging") — what must never leak is the actual
    // repo name from the payload.
    expect(logs.join("\n")).not.toContain("gh-e2e-org-4/unlinked-repo");

    consoleSpy.mockRestore();
  });

  it("logs a send failure by a distinguishable, non-sensitive reason and still returns 2xx, with no retry (REL-001, RES-001)", async () => {
    const logs: string[] = [];
    const consoleSpy = vi.spyOn(console, "log").mockImplementation((msg) => {
      logs.push(String(msg));
    });
    const calls = stubTelegramApi((method) =>
      method === "sendMessage"
        ? { ok: false, error_code: 400, description: "Bad Request: message thread not found" }
        : undefined,
    );
    await seedTeam("gh-e2e-team-5", 700_005);
    await seedClaim("gh-e2e-org-5", "gh-e2e-team-5");
    await seedLink("gh-e2e-team-5", "gh-e2e-org-5/repo-5", "gh-e2e-org-5", 5555);

    const res = await post(pullRequestPayload("gh-e2e-org-5/repo-5"), "pull_request");

    expect(res.status).toBe(200);
    // REL-001: the spec's "no retry within the same request" — exactly one
    // sendMessage call, never more.
    expect(calls.filter((c) => c.method === "sendMessage")).toHaveLength(1);
    const entry = logs.map((l) => JSON.parse(l)).find((e) => e.event === "github-webhook");
    // RES-001: a permanent 4xx (not 429) is classified "rejected", not the
    // generic bucket a 429 or a 5xx/network failure would get.
    expect(entry).toEqual({
      event: "github-webhook",
      outcome: "error",
      errorCode: "AlertSendFailed",
      reason: "rejected",
    });
    expect(logs.join("\n")).not.toMatch(/message thread not found/);

    consoleSpy.mockRestore();
  });

  it("classifies a 429 as rate-limited (RES-001)", async () => {
    const logs: string[] = [];
    const consoleSpy = vi.spyOn(console, "log").mockImplementation((msg) => {
      logs.push(String(msg));
    });
    stubTelegramApi((method) =>
      method === "sendMessage"
        ? { ok: false, error_code: 429, description: "Too Many Requests: retry after 5" }
        : undefined,
    );
    await seedTeam("gh-e2e-team-8", 700_008);
    await seedClaim("gh-e2e-org-8", "gh-e2e-team-8");
    await seedLink("gh-e2e-team-8", "gh-e2e-org-8/repo-8", "gh-e2e-org-8", 8888);

    const res = await post(pullRequestPayload("gh-e2e-org-8/repo-8"), "pull_request");

    expect(res.status).toBe(200);
    const entry = logs.map((l) => JSON.parse(l)).find((e) => e.event === "github-webhook");
    expect(entry).toEqual({
      event: "github-webhook",
      outcome: "error",
      errorCode: "AlertSendFailed",
      reason: "rate-limited",
    });
    expect(logs.join("\n")).not.toMatch(/Too Many Requests/);

    consoleSpy.mockRestore();
  });

  it("returns 500 and logs only the error name when D1 is unavailable during routing", async () => {
    const logs: string[] = [];
    const consoleSpy = vi.spyOn(console, "log").mockImplementation((msg) => {
      logs.push(String(msg));
    });
    stubTelegramApi();

    const brokenDbEnv = {
      ...env,
      DB: {
        prepare() {
          throw new Error("D1 unavailable — should never appear in logs");
        },
      },
    };

    const res = await post(pullRequestPayload("gh-e2e-org-6/repo-6"), "pull_request", brokenDbEnv);

    expect(res.status).toBe(500);
    const logged = logs.join("\n");
    expect(logged).not.toMatch(/D1 unavailable/);
    expect(logged).toMatch(/github-webhook/);

    consoleSpy.mockRestore();
  });

  it("never logs the payload fixture strings (title, url) for any outcome in this suite", async () => {
    const logs: string[] = [];
    const consoleSpy = vi.spyOn(console, "log").mockImplementation((msg) => {
      logs.push(String(msg));
    });
    stubTelegramApi();
    await seedTeam("gh-e2e-team-7", 700_007);
    await seedClaim("gh-e2e-org-7", "gh-e2e-team-7");
    await seedLink("gh-e2e-team-7", "gh-e2e-org-7/repo-7", "gh-e2e-org-7", 7777);

    await post(
      pullRequestPayload("gh-e2e-org-7/repo-7", {
        pull_request: {
          title: "leak-marker-title-value",
          html_url: "https://github.com/gh-e2e-org-7/repo-7/pull/42",
          merged: false,
        },
      }),
      "pull_request",
    );

    expect(logs.join("\n")).not.toContain("leak-marker-title-value");

    consoleSpy.mockRestore();
  });
});
