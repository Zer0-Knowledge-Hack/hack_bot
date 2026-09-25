import { describe, expect, it } from "vitest";
import { mapGithubEvent } from "../../../src/adapters/github/event-mapper";

// design.md "Event filtering": the adapter mapper is the only place that
// reads raw webhook JSON and turns it into an allowlisted GithubEvent, or
// null when the event/action combination is outside the supported set
// (spec: github-webhook "Unsupported Event or Action Ignored").

const COMMIT_EMAIL_MARKER = "leak-marker@example.com";

function pullRequestPayload(overrides: Record<string, unknown> = {}) {
  return {
    action: "opened",
    number: 42,
    sender: { login: "octocat" },
    repository: { full_name: "Octocat/Hello-World" },
    pull_request: {
      title: "Fix the thing",
      html_url: "https://github.com/octocat/hello-world/pull/42",
      merged: false,
    },
    // Fields that MUST never reach the mapped GithubEvent (allowlist test).
    head_commit: {
      author: { name: "A Committer", email: COMMIT_EMAIL_MARKER },
    },
    commits: [{ author: { name: "A Committer", email: COMMIT_EMAIL_MARKER } }],
    ...overrides,
  };
}

function issuePayload(overrides: Record<string, unknown> = {}) {
  return {
    action: "opened",
    number: 7,
    sender: { login: "octocat" },
    repository: { full_name: "octocat/hello-world" },
    issue: {
      title: "Something is broken",
      html_url: "https://github.com/octocat/hello-world/issues/7",
    },
    ...overrides,
  };
}

describe("mapGithubEvent — allowlisted fields only", () => {
  it("never lets a commit author email reach the mapped GithubEvent", () => {
    const event = mapGithubEvent("pull_request", pullRequestPayload());

    expect(event).not.toBeNull();
    expect(JSON.stringify(event)).not.toContain(COMMIT_EMAIL_MARKER);
    expect(JSON.stringify(event)).not.toContain("A Committer");
  });

  it("lowercases org and repo consistently with parseRepoFullName", () => {
    const event = mapGithubEvent("pull_request", pullRequestPayload());

    expect(event?.repo).toBe("octocat/hello-world");
    expect(event?.org).toBe("octocat");
  });

  it("maps a pull_request opened event", () => {
    const event = mapGithubEvent("pull_request", pullRequestPayload());

    expect(event).toMatchObject({
      org: "octocat",
      repo: "octocat/hello-world",
      kind: "pull_request",
      action: "opened",
      number: 42,
      title: "Fix the thing",
      url: "https://github.com/octocat/hello-world/pull/42",
      actor: "octocat",
    });
    expect(event?.reviewer).toBeUndefined();
  });

  it("derives 'merged' from closed + pull_request.merged === true", () => {
    const event = mapGithubEvent(
      "pull_request",
      pullRequestPayload({ action: "closed", pull_request: { title: "t", html_url: "u", merged: true } }),
    );

    expect(event?.action).toBe("merged");
  });

  it("maps a closed-but-not-merged pull_request to action 'closed'", () => {
    const event = mapGithubEvent(
      "pull_request",
      pullRequestPayload({ action: "closed", pull_request: { title: "t", html_url: "u", merged: false } }),
    );

    expect(event?.action).toBe("closed");
  });

  it("maps review_requested with a reviewer login", () => {
    const event = mapGithubEvent(
      "pull_request",
      pullRequestPayload({
        action: "review_requested",
        requested_reviewer: { login: "hubot" },
      }),
    );

    expect(event?.action).toBe("review_requested");
    expect(event?.reviewer).toBe("hubot");
  });

  it("maps review_requested with a requested team slug when no individual reviewer is set", () => {
    const event = mapGithubEvent(
      "pull_request",
      pullRequestPayload({
        action: "review_requested",
        requested_team: { slug: "core-team" },
      }),
    );

    expect(event?.action).toBe("review_requested");
    expect(event?.reviewer).toBe("core-team");
  });

  it("maps an issues opened event", () => {
    const event = mapGithubEvent("issues", issuePayload());

    expect(event).toMatchObject({
      org: "octocat",
      repo: "octocat/hello-world",
      kind: "issues",
      action: "opened",
      number: 7,
      title: "Something is broken",
      url: "https://github.com/octocat/hello-world/issues/7",
      actor: "octocat",
    });
  });

  it("maps an issues closed event", () => {
    const event = mapGithubEvent("issues", issuePayload({ action: "closed" }));

    expect(event?.action).toBe("closed");
  });
});

describe("mapGithubEvent — unsupported event/action returns null", () => {
  it("returns null for an event type outside the supported set (e.g. push)", () => {
    expect(mapGithubEvent("push", { any: "thing" })).toBeNull();
  });

  it("returns null for a supported event with an unsupported action (e.g. pull_request.labeled)", () => {
    expect(mapGithubEvent("pull_request", pullRequestPayload({ action: "labeled" }))).toBeNull();
  });

  it("returns null for an unsupported issues action (e.g. assigned)", () => {
    expect(mapGithubEvent("issues", issuePayload({ action: "assigned" }))).toBeNull();
  });

  it("returns null for the ping event", () => {
    expect(mapGithubEvent("ping", { zen: "z" })).toBeNull();
  });

  it("returns null when repository.full_name is missing or malformed", () => {
    expect(
      mapGithubEvent("pull_request", pullRequestPayload({ repository: { full_name: "not-a-repo" } })),
    ).toBeNull();
  });

  it("returns null when the payload is not an object", () => {
    expect(mapGithubEvent("pull_request", null)).toBeNull();
    expect(mapGithubEvent("pull_request", "oops")).toBeNull();
  });
});

// REL-002 (PR4 correction): characterization tests for the mapper's other
// null-guard branches — pinning down existing behavior that had no direct
// test, not new behavior.
describe("mapGithubEvent — null-guard branches (REL-002, characterization)", () => {
  it("returns null when sender.login is missing", () => {
    const payload = pullRequestPayload();
    delete (payload as { sender?: unknown }).sender;

    expect(mapGithubEvent("pull_request", payload)).toBeNull();
  });

  it("returns null when number is missing", () => {
    const payload = pullRequestPayload();
    delete (payload as { number?: unknown }).number;

    expect(mapGithubEvent("pull_request", payload)).toBeNull();
  });

  it("returns null for a pull_request event with no pull_request object", () => {
    const payload = pullRequestPayload();
    delete (payload as { pull_request?: unknown }).pull_request;

    expect(mapGithubEvent("pull_request", payload)).toBeNull();
  });

  it("returns null for an issues event with no issue object", () => {
    const payload = issuePayload();
    delete (payload as { issue?: unknown }).issue;

    expect(mapGithubEvent("issues", payload)).toBeNull();
  });
});
