import { describe, expect, it } from "vitest";
import { createGithubRepoMetadataSource } from "../../../src/adapters/github/repo-metadata";
import { parseRepoFullName } from "../../../src/domain/github";

// task 8.3: public GitHub REST call, 3 s timeout, injected fetch. Best-effort
// enrichment (design.md "Data Flow": "repoLinks+metadata") — every failure
// mode returns null rather than throwing.

const REPO = parseRepoFullName("octocat/hello-world")!;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createGithubRepoMetadataSource", () => {
  it("returns the repo description on a successful call", async () => {
    let requestedUrl: string | undefined;
    let requestedInit: RequestInit | undefined;
    const fetchFake: typeof fetch = async (input, init) => {
      requestedUrl = String(input);
      requestedInit = init;
      return jsonResponse({ description: "A hackathon starter repo" });
    };
    const source = createGithubRepoMetadataSource({ fetch: fetchFake });

    const result = await source.fetchDescription(REPO);

    expect(result).toBe("A hackathon starter repo");
    expect(requestedUrl).toBe("https://api.github.com/repos/octocat/hello-world");
    expect((requestedInit?.headers as Record<string, string> | undefined)?.Accept).toContain("github");
    expect(requestedInit?.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns null when the description field is missing", async () => {
    const fetchFake: typeof fetch = async () => jsonResponse({ full_name: "octocat/hello-world" });
    const source = createGithubRepoMetadataSource({ fetch: fetchFake });

    expect(await source.fetchDescription(REPO)).toBeNull();
  });

  it("returns null when the description is an empty or whitespace-only string", async () => {
    const fetchFake: typeof fetch = async () => jsonResponse({ description: "   " });
    const source = createGithubRepoMetadataSource({ fetch: fetchFake });

    expect(await source.fetchDescription(REPO)).toBeNull();
  });

  it("returns null on a non-2xx response (e.g. 404 for a private or deleted repo)", async () => {
    const fetchFake: typeof fetch = async () => jsonResponse({ message: "Not Found" }, 404);
    const source = createGithubRepoMetadataSource({ fetch: fetchFake });

    expect(await source.fetchDescription(REPO)).toBeNull();
  });

  it("returns null on a network error", async () => {
    const fetchFake: typeof fetch = async () => {
      throw new TypeError("network error");
    };
    const source = createGithubRepoMetadataSource({ fetch: fetchFake });

    expect(await source.fetchDescription(REPO)).toBeNull();
  });

  it("returns null when the response body is not valid JSON", async () => {
    const fetchFake: typeof fetch = async () =>
      new Response("not json", { status: 200, headers: { "content-type": "text/plain" } });
    const source = createGithubRepoMetadataSource({ fetch: fetchFake });

    expect(await source.fetchDescription(REPO)).toBeNull();
  });

  it("applies a 3 s timeout via an AbortSignal passed to fetch", async () => {
    let capturedSignal: AbortSignal | undefined;
    const fetchFake: typeof fetch = async (_input, init) => {
      capturedSignal = init?.signal as AbortSignal | undefined;
      return jsonResponse({ description: "ok" });
    };
    const source = createGithubRepoMetadataSource({ fetch: fetchFake });

    await source.fetchDescription(REPO);

    expect(capturedSignal).toBeInstanceOf(AbortSignal);
  });
});
