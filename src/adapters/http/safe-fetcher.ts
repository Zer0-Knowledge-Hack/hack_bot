import { PageFetchFailedError, UnsafeUrlError, type PageFetchFailureKind } from "../../domain/errors";
import { assertSafeUrl } from "../../domain/hackathon/url";
import type { PageFetcher } from "../../domain/ports";
import { htmlToText, TEXT_MAX } from "./html-to-text";

// Static, non-JS-rendered page fetch (design.md "The static fetcher uses
// redirect: manual. It follows at most 3 hops, re-guarding each one, and
// streams up to 2 MB. It accepts only a 200 text/html or text/plain
// response."; page-fetch spec "Scheme and Destination Guard on the Static
// Path", "Size and Time Caps on Static Fetch"). `signal` already carries
// the caller's 10 s step timeout (analyzeHackathon computes it from the
// injected Clock) — this adapter never starts a wall-clock timer of its
// own, it only reacts to the signal it was given.
//
// Reduction to plain text (html-to-text.ts, task 6.3) is applied to every
// `text/html` response; a `text/plain` response has no markup to reduce and
// is capped and returned as-is.

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024; // ~2 MB (page-fetch spec)
const DEFAULT_MAX_HOPS = 3; // design.md: "follows at most 3 hops"
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const ALLOWED_CONTENT_TYPES = new Set(["text/html", "text/plain"]);

export interface StaticFetcherOptions {
  fetch: typeof fetch;
  maxBytes?: number;
  maxHops?: number;
}

// Thrown only by the byte-counting transform stream below; never escapes
// this module. Caught in the loop and mapped to
// PageFetchFailedError("too-large"). A fixed message (rather than a
// subclass check) survives being re-wrapped by whatever consumes the
// stream downstream (html-to-text.ts's HTMLRewriter, or a raw `.text()`
// read) — HTMLRewriter does not guarantee the original error's prototype
// chain reaches the caller unchanged.
const TOO_LARGE_MESSAGE = "response exceeded the byte cap";

function isTooLargeError(err: unknown): boolean {
  return err instanceof Error && err.message.includes(TOO_LARGE_MESSAGE);
}

// Streams `response.body` through a byte counter so the size cap is
// enforced WHILE reading, not just via a (spoofable, sometimes-absent)
// Content-Length header (page-fetch spec: "Response exceeds the size cap
// ... WHEN the fetch is in progress").
function limitResponseBytes(response: Response, maxBytes: number): Response {
  const body = response.body;
  if (!body) return response;
  let total = 0;
  const limited = body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        total += chunk.byteLength;
        if (total > maxBytes) {
          controller.error(new Error(TOO_LARGE_MESSAGE));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
  return new Response(limited, { status: response.status, headers: response.headers });
}

function contentTypeAllowed(contentType: string): boolean {
  const mime = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return ALLOWED_CONTENT_TYPES.has(mime);
}

function fail(message: string, kind: PageFetchFailureKind): never {
  throw new PageFetchFailedError(message, kind);
}

export function createStaticFetcher(options: StaticFetcherOptions): PageFetcher {
  const doFetch = options.fetch;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxHops = options.maxHops ?? DEFAULT_MAX_HOPS;

  return {
    async fetch(url: string, signal: AbortSignal): Promise<string> {
      let current = url;
      let hops = 0;

      for (;;) {
        const guard = assertSafeUrl(current);
        if (!guard.ok) {
          throw new UnsafeUrlError(`unsafe fetch target: ${guard.reason}`, guard.reason);
        }

        let response: Response;
        try {
          response = await doFetch(guard.url.toString(), { redirect: "manual", signal });
        } catch {
          if (signal.aborted) fail("static fetch timed out", "timeout");
          throw new PageFetchFailedError("static fetch network error", "network");
        }

        if (REDIRECT_STATUSES.has(response.status)) {
          if (hops >= maxHops) fail("too many redirects", "redirects");
          const location = response.headers.get("location");
          if (!location) fail("redirect response had no Location header", "redirects");
          let next: URL;
          try {
            next = new URL(location, guard.url);
          } catch {
            fail("redirect Location header was not a valid URL", "redirects");
          }
          current = next.toString();
          hops += 1;
          continue;
        }

        if (response.status < 200 || response.status >= 300) {
          fail(`unexpected HTTP status ${response.status}`, "http-status");
        }

        const contentType = response.headers.get("content-type") ?? "";
        if (!contentTypeAllowed(contentType)) {
          fail(`unexpected content-type "${contentType}"`, "content-type");
        }

        const limited = limitResponseBytes(response, maxBytes);
        const mime = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
        try {
          // text/plain has no markup to reduce; text/html is run through
          // html-to-text.ts's HTMLRewriter pass (task 6.3).
          return mime === "text/html"
            ? await htmlToText(limited)
            : (await limited.text()).slice(0, TEXT_MAX);
        } catch (err) {
          if (isTooLargeError(err)) fail("response exceeded the size cap", "too-large");
          if (signal.aborted) fail("static fetch timed out", "timeout");
          throw new PageFetchFailedError("failed to read response body", "network");
        }
      }
    },
  };
}
