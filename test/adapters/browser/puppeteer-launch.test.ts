import { describe, expect, it } from "vitest";
import { BrowserQuotaExceededError } from "../../../src/domain/errors";
import { launchPuppeteerBrowser } from "../../../src/adapters/browser/puppeteer-launch";

// task 10.4 (design.md "File Changes": "Puppeteer with an injected
// `launch`"): the production `launch` runs the real `@cloudflare/puppeteer`
// against a fake Browser Rendering binding, so no real browser is started.
// (The package is not `vi.mock`ed: the main worker shares this isolate and
// already imports it, which would make a module mock unreliable.)
//
// Documented Browser Run errors (developers.cloudflare.com/browser-run/
// limits, checked 2026-09-28): the daily free-plan limit ("429 Browser time
// limit exceeded for today") and the rate limit ("429 Too many requests") are
// answered by the acquire request itself, so `launch` rejects — there is no
// page or navigation status yet, and the fetcher's post-`goto` 429 check
// would never see them. Mapping them here makes the use case degrade exactly
// as designed.

function fakeBinding(status: number, body: string) {
  const requests: Array<{ url: string; method: string | undefined }> = [];
  return {
    requests,
    binding: {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ url: String(input), method: init?.method });
        return new Response(body, { status });
      },
    },
  };
}

describe("launchPuppeteerBrowser", () => {
  it.each([
    ["the daily limit", "Browser time limit exceeded for today"],
    ["the rate limit", "Too many requests"],
  ])("maps a 429 acquire response (%s) to BrowserQuotaExceededError", async (_label, body) => {
    const { binding, requests } = fakeBinding(429, body);

    await expect(launchPuppeteerBrowser(binding)).rejects.toBeInstanceOf(BrowserQuotaExceededError);

    // The real package really did call the Browser Rendering binding.
    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.url).toContain("/v1/devtools/browser");
  });

  it("propagates any other launch failure unchanged so the caller can treat it as transient", async () => {
    const { binding } = fakeBinding(500, "internal error");

    const err = await launchPuppeteerBrowser(binding).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(BrowserQuotaExceededError);
    expect((err as Error).message).toContain("code: 500");
  });

  it("does not misread a non-429 status whose message merely mentions a number", async () => {
    const { binding } = fakeBinding(503, "retry in 4290 ms");

    const err = await launchPuppeteerBrowser(binding).catch((e: unknown) => e);

    expect(err).not.toBeInstanceOf(BrowserQuotaExceededError);
  });
});
