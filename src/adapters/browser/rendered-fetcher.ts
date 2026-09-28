import { BrowserQuotaExceededError, PageFetchFailedError, UnsafeUrlError } from "../../domain/errors";
import { assertSafeUrl } from "../../domain/hackathon/url";
import type { PageFetcher } from "../../domain/ports";
import { TEXT_MAX } from "../http/html-to-text";

// Browser (Cloudflare Browser Rendering / @cloudflare/puppeteer) page fetch
// for JS-heavy pages the static fetcher's text falls short on (design.md
// "The rendered fetcher calls page.setRequestInterception(true). Each
// request goes through the pure browserRequestPolicy: http(s) only, the
// same host guard, images, fonts, media and stylesheets aborted, and at
// most 100 requests. After goto, it re-checks page.url() ... and calls
// browser.close() in finally. A 429 raises BrowserQuotaExceededError.";
// page-fetch spec "Same Guard Applies to the Browser Fallback", "Browser
// rendering redirect to an unsafe target").
//
// `launch` and the concrete Browser/Page types below are a minimal
// structural subset of @cloudflare/puppeteer's shape — narrow enough that
// tests inject plain fakes, never a real browser, and this module never
// imports the actual package.

export interface BrowserResponse {
  status(): number;
}

export interface InterceptedRequest {
  url(): string;
  resourceType(): string;
  abort(): void | Promise<void>;
  continue(): void | Promise<void>;
}

export interface BrowserPage {
  setRequestInterception(value: boolean): Promise<void>;
  on(event: "request", handler: (request: InterceptedRequest) => void): void;
  goto(url: string): Promise<BrowserResponse | null>;
  url(): string;
  evaluate<T>(fn: () => T): Promise<T>;
}

export interface Browser {
  newPage(): Promise<BrowserPage>;
  close(): Promise<void>;
}

export type BrowserLaunch = (binding: unknown) => Promise<Browser>;

export interface RenderedFetcherOptions {
  launch: BrowserLaunch;
  binding: unknown;
  maxRequests?: number;
}

const DEFAULT_MAX_REQUESTS = 100; // design.md: "at most 100 requests"

// Sub-resource types that never carry text useful to the LLM extractor and
// only cost bandwidth/time to fetch (design.md: "images, fonts, media and
// stylesheets aborted").
const BLOCKED_RESOURCE_TYPES = new Set(["image", "font", "media", "stylesheet"]);

// Pure so it is directly unit-testable without a browser (design.md "the
// pure browserRequestPolicy"). `requestCount` is the 1-based count of this
// request within the page load (the caller increments before calling).
export function browserRequestPolicy(
  url: string,
  resourceType: string,
  requestCount: number,
  maxRequests: number = DEFAULT_MAX_REQUESTS,
): "allow" | "abort" {
  if (requestCount > maxRequests) return "abort";
  if (BLOCKED_RESOURCE_TYPES.has(resourceType)) return "abort";
  if (!assertSafeUrl(url).ok) return "abort";
  return "allow";
}

// Races `promise` against `signal` so a caller-driven abort rejects even
// when the underlying puppeteer call (e.g. `page.goto`) never settles on
// its own. Mirrors safe-fetcher.ts's reliance on the caller's AbortSignal
// for the step timeout — this adapter never starts a wall-clock timer of
// its own.
function raceWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new DOMException("The operation was aborted", "AbortError"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException("The operation was aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

export function createRenderedFetcher(options: RenderedFetcherOptions): PageFetcher {
  const { launch, binding, maxRequests = DEFAULT_MAX_REQUESTS } = options;

  return {
    async fetch(url: string, signal: AbortSignal): Promise<string> {
      const guard = assertSafeUrl(url);
      if (!guard.ok) {
        throw new UnsafeUrlError(`unsafe fetch target: ${guard.reason}`, guard.reason);
      }

      // Guard runs before ever launching a browser (spec: "Browser path
      // refuses an unsafe target ... THEN the system MUST refuse without
      // rendering the page").
      const browser = await launch(binding);
      try {
        const page = await browser.newPage();

        let requestCount = 0;
        await page.setRequestInterception(true);
        page.on("request", (request) => {
          requestCount += 1;
          const decision = browserRequestPolicy(
            request.url(),
            request.resourceType(),
            requestCount,
            maxRequests,
          );
          if (decision === "abort") {
            void request.abort();
          } else {
            void request.continue();
          }
        });

        let response: BrowserResponse | null;
        try {
          response = await raceWithSignal(page.goto(guard.url.toString()), signal);
        } catch {
          if (signal.aborted) {
            throw new PageFetchFailedError("rendered fetch timed out", "timeout");
          }
          throw new PageFetchFailedError("rendered fetch network error", "network");
        }

        if (response !== null && response.status() === 429) {
          throw new BrowserQuotaExceededError("browser rendering quota exceeded");
        }

        // Re-check the final URL after navigation (page-fetch spec:
        // "Browser rendering redirect to an unsafe target" — the guard
        // MUST also cover a redirect encountered during rendering, not
        // just the initial target).
        const finalGuard = assertSafeUrl(page.url());
        if (!finalGuard.ok) {
          throw new UnsafeUrlError(`unsafe redirect target: ${finalGuard.reason}`, finalGuard.reason);
        }

        // Cast through `globalThis` rather than referencing `document`
        // directly: this project's tsconfig has no DOM lib (it targets the
        // Workers runtime), and this function body is only ever serialized
        // and executed inside the rendered *page's* browser context by the
        // real puppeteer adapter, never by this Worker's own runtime.
        const innerText = await page.evaluate(
          () =>
            (globalThis as unknown as { document?: { body?: { innerText?: string } } }).document?.body
              ?.innerText ?? "",
        );
        return innerText.slice(0, TEXT_MAX);
      } finally {
        // Always released, even on refusal/timeout/quota (design.md "calls
        // browser.close() in finally").
        await browser.close();
      }
    },
  };
}
