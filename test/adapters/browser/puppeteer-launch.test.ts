import { describe, expect, it, vi } from "vitest";

// task 10.4 (design.md "File Changes": "Puppeteer with an injected
// `launch`"): the production `launch` is a thin pass-through to
// `@cloudflare/puppeteer`'s `launch(binding)`. The package is mocked — no real
// browser is ever started.
const launchMock = vi.hoisted(() => vi.fn());
vi.mock("@cloudflare/puppeteer", () => ({ default: { launch: launchMock } }));

import { BrowserQuotaExceededError } from "../../../src/domain/errors";
import { launchPuppeteerBrowser } from "../../../src/adapters/browser/puppeteer-launch";

describe("launchPuppeteerBrowser", () => {
  it("launches through @cloudflare/puppeteer with the Browser Rendering binding and returns the browser", async () => {
    const browser = { newPage: async () => ({}), close: async () => {} };
    launchMock.mockResolvedValueOnce(browser);
    const binding = { fetch: async () => new Response("") };

    const launched = await launchPuppeteerBrowser(binding);

    expect(launched).toBe(browser);
    expect(launchMock).toHaveBeenCalledTimes(1);
    expect(launchMock).toHaveBeenCalledWith(binding);
  });

  // Documented Browser Run errors (developers.cloudflare.com/browser-run/
  // limits, checked 2026-09-28): the daily free-plan limit and the rate limit
  // are both thrown by `launch` itself (there is no page yet), not returned
  // as a navigation status, so the fetcher's post-goto 429 check never sees
  // them. Mapping here makes the use case degrade exactly as designed.
  it.each([
    "Error processing the request: Unable to create new browser: code: 429: message: Browser time limit exceeded for today",
    "429 Too many requests",
  ])("maps the documented launch error (%s) to BrowserQuotaExceededError", async (message) => {
    launchMock.mockRejectedValueOnce(new Error(message));

    await expect(launchPuppeteerBrowser({})).rejects.toBeInstanceOf(BrowserQuotaExceededError);
  });

  it("propagates any other launch failure unchanged", async () => {
    const failure = new Error("Unable to create new browser: code: 500: message: internal error");
    launchMock.mockRejectedValueOnce(failure);

    await expect(launchPuppeteerBrowser({})).rejects.toBe(failure);
  });
});
