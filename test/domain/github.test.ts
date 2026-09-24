import { describe, expect, it } from "vitest";
import { formatGithubAlert, parseRepoFullName } from "../../src/domain/github";
import type { GithubEvent } from "../../src/domain/github";

describe("parseRepoFullName", () => {
  it("accepts a lowercase owner/repo shape", () => {
    expect(parseRepoFullName("octocat/hello-world")).toBe("octocat/hello-world");
  });

  it("lowercases a mixed-case input", () => {
    expect(parseRepoFullName("OctoCat/Hello-World")).toBe("octocat/hello-world");
  });

  it("rejects a string with no slash", () => {
    expect(parseRepoFullName("octocat")).toBeNull();
  });

  it("rejects a string with more than one slash", () => {
    expect(parseRepoFullName("octocat/hello/world")).toBeNull();
  });

  it("rejects an empty owner or repo segment", () => {
    expect(parseRepoFullName("/hello-world")).toBeNull();
    expect(parseRepoFullName("octocat/")).toBeNull();
  });

  it("rejects whitespace inside the name", () => {
    expect(parseRepoFullName("octo cat/hello world")).toBeNull();
  });
});

function makeEvent(overrides: Partial<GithubEvent> = {}): GithubEvent {
  return {
    org: "octocat",
    repo: parseRepoFullName("octocat/hello-world")!,
    kind: "pull_request",
    action: "opened",
    number: 42,
    title: "Fix the thing",
    url: "https://github.com/octocat/hello-world/pull/42",
    actor: "octocat",
    ...overrides,
  };
}

describe("formatGithubAlert", () => {
  it("includes only the allowlisted fields", () => {
    const text = formatGithubAlert(makeEvent());
    expect(text).toContain("octocat/hello-world");
    expect(text).toContain("#42");
    expect(text).toContain("Fix the thing");
    expect(text).toContain("octocat");
    expect(text).toContain("https://github.com/octocat/hello-world/pull/42");
  });

  it("truncates a very long title so the message stays at most 4096 characters", () => {
    const longTitle = "x".repeat(5000);
    const text = formatGithubAlert(makeEvent({ title: longTitle }));
    expect(text.length).toBeLessThanOrEqual(4096);
  });

  it("caps the title itself at 256 characters", () => {
    const longTitle = "y".repeat(500);
    const text = formatGithubAlert(makeEvent({ title: longTitle }));
    expect(text).not.toContain("y".repeat(300));
  });

  it("remains a non-empty string for a normal event", () => {
    const text = formatGithubAlert(makeEvent());
    expect(text.length).toBeGreaterThan(0);
    expect(text.length).toBeLessThanOrEqual(4096);
  });

  it("includes a Reviewer line with the exact output when reviewer is set", () => {
    const text = formatGithubAlert(
      makeEvent({
        kind: "pull_request",
        action: "review_requested",
        reviewer: "hubot",
      }),
    );
    expect(text).toBe(
      [
        "octocat/hello-world — pull_request review_requested",
        "#42: Fix the thing",
        "Reviewer: hubot",
        "By: octocat",
        "https://github.com/octocat/hello-world/pull/42",
      ].join("\n"),
    );
  });

  it("omits the Reviewer line entirely when reviewer is not set", () => {
    const text = formatGithubAlert(makeEvent({ action: "review_requested" }));
    expect(text).not.toContain("Reviewer:");
  });

  it("formats a merged pull_request alert with the exact output", () => {
    const text = formatGithubAlert(makeEvent({ kind: "pull_request", action: "merged" }));
    expect(text).toBe(
      [
        "octocat/hello-world — pull_request merged",
        "#42: Fix the thing",
        "By: octocat",
        "https://github.com/octocat/hello-world/pull/42",
      ].join("\n"),
    );
  });
});
