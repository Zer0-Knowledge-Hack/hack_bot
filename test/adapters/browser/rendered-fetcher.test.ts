import { describe, expect, it } from "vitest";
import {
  browserRequestPolicy,
  createRenderedFetcher,
  type Browser,
  type BrowserPage,
  type InterceptedRequest,
} from "../../../src/adapters/browser/rendered-fetcher";
import { TEXT_MAX } from "../../../src/adapters/http/html-to-text";
import { BrowserQuotaExceededError, PageFetchFailedError, UnsafeUrlError } from "../../../src/domain/errors";

// task 7.1 (page-fetch spec: "Same Guard Applies to the Browser Fallback",
// "Browser rendering redirect to an unsafe target"; design.md "The rendered
// fetcher calls page.setRequestInterception(true). Each request goes
// through the pure browserRequestPolicy: http(s) only, the same host
// guard, images, fonts, media and stylesheets aborted, and at most 100
// requests. After goto, it re-checks page.url() ... and calls
// browser.close() in finally. A 429 raises BrowserQuotaExceededError."). No
// real browser is ever launched: `launch` is injected and every test uses a
// fake Browser/Page.

function fakeRequest(url: string, resourceType: string): InterceptedRequest & {
  aborted: boolean;
  continued: boolean;
} {
  const req = {
    aborted: false,
    continued: false,
    url: () => url,
    resourceType: () => resourceType,
    abort() {
      req.aborted = true;
    },
    continue() {
      req.continued = true;
    },
  };
  return req;
}

interface FakePageOptions {
  finalUrl?: string;
  status?: number;
  innerText?: string;
  gotoImpl?: () => Promise<{ status(): number } | null>;
  evaluateImpl?: () => Promise<string>;
  closeImpl?: () => Promise<void>;
  requests?: Array<{ url: string; resourceType: string }>;
}

function fakePage(options: FakePageOptions = {}) {
  const {
    finalUrl = "https://example.com/event",
    status = 200,
    innerText = "rendered page text",
    gotoImpl,
    evaluateImpl,
    requests = [],
  } = options;

  let interceptionEnabled = false;
  let requestHandler: ((request: InterceptedRequest) => void) | undefined;
  const seenRequests: Array<InterceptedRequest & { aborted: boolean; continued: boolean }> = [];

  const page: BrowserPage = {
    async setRequestInterception(value: boolean) {
      interceptionEnabled = value;
    },
    on(event, handler) {
      if (event === "request") requestHandler = handler;
    },
    async goto(_url: string) {
      // Fire every scripted request through the registered handler, exactly
      // as puppeteer would as the page loads sub-resources.
      if (requestHandler) {
        for (const r of requests) {
          const req = fakeRequest(r.url, r.resourceType);
          seenRequests.push(req);
          requestHandler(req);
        }
      }
      if (gotoImpl) return gotoImpl();
      return { status: () => status };
    },
    url: () => finalUrl,
    async evaluate<T>(fn: () => T): Promise<T> {
      void fn;
      if (evaluateImpl) return (await evaluateImpl()) as unknown as T;
      return innerText as unknown as T;
    },
  };

  return {
    page,
    seenRequests,
    interceptionEnabled: () => interceptionEnabled,
  };
}

function fakeBrowser(pageOptions: FakePageOptions = {}) {
  const { page, seenRequests, interceptionEnabled } = fakePage(pageOptions);
  let closed = false;
  const browser: Browser = {
    async newPage() {
      return page;
    },
    async close() {
      closed = true;
      if (pageOptions.closeImpl) await pageOptions.closeImpl();
    },
  };
  return { browser, seenRequests, interceptionEnabled, isClosed: () => closed };
}

describe("browserRequestPolicy", () => {
  it("allows an http(s) request to a safe host under the request cap", () => {
    expect(browserRequestPolicy("https://example.com/script.js", "script", 1)).toBe("allow");
  });

  it("aborts a non-http(s) request", () => {
    expect(browserRequestPolicy("file:///etc/passwd", "document", 1)).toBe("abort");
  });

  it("aborts a request to a private/loopback host (host re-guard)", () => {
    expect(browserRequestPolicy("http://169.254.169.254/latest/meta-data", "xhr", 1)).toBe("abort");
  });

  it.each(["image", "font", "media", "stylesheet"])("aborts a %s request", (resourceType) => {
    expect(browserRequestPolicy("https://example.com/asset", resourceType, 1)).toBe("abort");
  });

  it("allows a document/script/xhr request to a safe host", () => {
    expect(browserRequestPolicy("https://example.com/api", "xhr", 1)).toBe("allow");
  });

  it("aborts once the request count exceeds the 100-request cap", () => {
    expect(browserRequestPolicy("https://example.com/ok", "script", 100)).toBe("allow");
    expect(browserRequestPolicy("https://example.com/ok", "script", 101)).toBe("abort");
  });
});

describe("createRenderedFetcher", () => {
  it("renders the page and returns its inner text", async () => {
    const { browser, isClosed } = fakeBrowser({ innerText: "hello from the browser" });
    const fetcher = createRenderedFetcher({ launch: async () => browser, binding: {} });

    const text = await fetcher.fetch("https://example.com/event", new AbortController().signal);

    expect(text).toBe("hello from the browser");
    expect(isClosed()).toBe(true);
  });

  it("returns inner text from a table with tabs without any tab characters", async () => {
    const { browser } = fakeBrowser({ innerText: "Prize\tAmount\n1st\t$5,000\n2nd\t\t$2,000" });
    const fetcher = createRenderedFetcher({ launch: async () => browser, binding: {} });

    const text = await fetcher.fetch("https://example.com/event", new AbortController().signal);

    expect(text).toBe("Prize Amount\n1st $5,000\n2nd $2,000");
  });

  it("still caps normalized rendered text at TEXT_MAX", async () => {
    const { browser } = fakeBrowser({ innerText: "word\t".repeat(10_000) });
    const fetcher = createRenderedFetcher({ launch: async () => browser, binding: {} });

    const text = await fetcher.fetch("https://example.com/event", new AbortController().signal);

    expect(text.length).toBeLessThanOrEqual(TEXT_MAX);
    expect(text).not.toContain("\t");
  });

  it("refuses the initial URL before launching the browser (spec: Same Guard Applies to the Browser Fallback)", async () => {
    let launched = false;
    const fetcher = createRenderedFetcher({
      launch: async () => {
        launched = true;
        throw new Error("must not launch");
      },
      binding: {},
    });

    await expect(
      fetcher.fetch("http://127.0.0.1/internal", new AbortController().signal),
    ).rejects.toBeInstanceOf(UnsafeUrlError);
    expect(launched).toBe(false);
  });

  it("enables request interception and routes every request through the policy", async () => {
    const { browser, seenRequests, interceptionEnabled } = fakeBrowser({
      requests: [
        { url: "https://example.com/style.css", resourceType: "stylesheet" },
        { url: "https://example.com/api", resourceType: "xhr" },
        { url: "http://169.254.169.254/latest/meta-data", resourceType: "xhr" },
      ],
    });
    const fetcher = createRenderedFetcher({ launch: async () => browser, binding: {} });

    await fetcher.fetch("https://example.com/event", new AbortController().signal);

    expect(interceptionEnabled()).toBe(true);
    expect(seenRequests).toHaveLength(3);
    expect(seenRequests[0]?.aborted).toBe(true); // stylesheet
    expect(seenRequests[1]?.continued).toBe(true); // safe xhr
    expect(seenRequests[2]?.aborted).toBe(true); // unsafe host xhr
  });

  it("aborts requests beyond the 100-request cap", async () => {
    const requests = Array.from({ length: 105 }, (_, i) => ({
      url: `https://example.com/r${i}`,
      resourceType: "script",
    }));
    const { browser, seenRequests } = fakeBrowser({ requests });
    const fetcher = createRenderedFetcher({ launch: async () => browser, binding: {} });

    await fetcher.fetch("https://example.com/event", new AbortController().signal);

    expect(seenRequests).toHaveLength(105);
    expect(seenRequests.slice(0, 100).every((r) => r.continued)).toBe(true);
    expect(seenRequests.slice(100).every((r) => r.aborted)).toBe(true);
  });

  it("re-checks page.url() after goto and refuses a redirect to an unsafe target (spec: Browser rendering redirect to an unsafe target)", async () => {
    const { browser, isClosed } = fakeBrowser({ finalUrl: "http://127.0.0.1/internal" });
    const fetcher = createRenderedFetcher({ launch: async () => browser, binding: {} });

    await expect(
      fetcher.fetch("https://example.com/event", new AbortController().signal),
    ).rejects.toBeInstanceOf(UnsafeUrlError);
    expect(isClosed()).toBe(true);
  });

  it("closes the browser even when goto throws", async () => {
    const { browser, isClosed } = fakeBrowser({
      gotoImpl: async () => {
        throw new Error("network boom");
      },
    });
    const fetcher = createRenderedFetcher({ launch: async () => browser, binding: {} });

    await expect(
      fetcher.fetch("https://example.com/event", new AbortController().signal),
    ).rejects.toBeInstanceOf(PageFetchFailedError);
    expect(isClosed()).toBe(true);
  });

  it("raises BrowserQuotaExceededError on a 429 response and still closes the browser", async () => {
    const { browser, isClosed } = fakeBrowser({ status: 429 });
    const fetcher = createRenderedFetcher({ launch: async () => browser, binding: {} });

    await expect(
      fetcher.fetch("https://example.com/event", new AbortController().signal),
    ).rejects.toBeInstanceOf(BrowserQuotaExceededError);
    expect(isClosed()).toBe(true);
  });

  it("reports a timeout when the caller's AbortSignal fires before goto resolves", async () => {
    const controller = new AbortController();
    const { browser, isClosed } = fakeBrowser({
      gotoImpl: () => new Promise(() => {}), // never resolves
    });
    const fetcher = createRenderedFetcher({ launch: async () => browser, binding: {} });

    const pending = fetcher.fetch("https://example.com/event", controller.signal);
    controller.abort();
    const err = await pending.catch((e) => e);

    expect(err).toBeInstanceOf(PageFetchFailedError);
    expect((err as PageFetchFailedError).kind).toBe("timeout");
    expect(isClosed()).toBe(true);
  });

  it("reports a timeout and closes the browser when evaluate never settles (RISK-001)", async () => {
    const controller = new AbortController();
    const { browser, isClosed } = fakeBrowser({
      evaluateImpl: () => new Promise(() => {}), // never resolves
    });
    const fetcher = createRenderedFetcher({ launch: async () => browser, binding: {} });

    const pending = fetcher.fetch("https://example.com/event", controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 0)); // let fetch reach evaluate
    controller.abort();
    const err = await pending.catch((e) => e);

    expect(err).toBeInstanceOf(PageFetchFailedError);
    expect((err as PageFetchFailedError).kind).toBe("timeout");
    expect(isClosed()).toBe(true);
  });

  it("keeps the original error when browser.close() also fails (RESI-001)", async () => {
    const { browser } = fakeBrowser({
      finalUrl: "http://127.0.0.1/internal",
      closeImpl: async () => {
        throw new Error("close failed");
      },
    });
    const fetcher = createRenderedFetcher({ launch: async () => browser, binding: {} });

    await expect(
      fetcher.fetch("https://example.com/event", new AbortController().signal),
    ).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it("still returns the text when browser.close() fails after a successful render (RESI-001)", async () => {
    const { browser } = fakeBrowser({
      innerText: "rendered",
      closeImpl: async () => {
        throw new Error("close failed");
      },
    });
    const fetcher = createRenderedFetcher({ launch: async () => browser, binding: {} });

    await expect(
      fetcher.fetch("https://example.com/event", new AbortController().signal),
    ).resolves.toBe("rendered");
  });
});
