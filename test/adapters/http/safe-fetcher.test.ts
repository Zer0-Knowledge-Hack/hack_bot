import { describe, expect, it } from "vitest";
import { createStaticFetcher } from "../../../src/adapters/http/safe-fetcher";
import { PageFetchFailedError, UnsafeUrlError } from "../../../src/domain/errors";

// task 6.1/6.2 (page-fetch spec: "Scheme and Destination Guard on the
// Static Path", "Size and Time Caps on Static Fetch"; design.md "The static
// fetcher uses redirect: manual. It follows at most 3 hops, re-guarding
// each one, and streams up to 2 MB. It accepts only a 200 text/html or
// text/plain response."). `fetch` is injected so no test ever hits the
// network; the byte and hop caps are overridden to small values so the
// tests stay fast and deterministic while still exercising the real
// streaming/hop-counting logic.

type FetchCall = { url: string; init: RequestInit | undefined };

function htmlResponse(body: string, init?: ResponseInit) {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html" },
    ...init,
  });
}

function redirectResponse(location: string, status = 302) {
  return new Response(null, { status, headers: { location } });
}

function scriptedFetch(responses: Array<Response | (() => Response)>) {
  const calls: FetchCall[] = [];
  let i = 0;
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const entry = responses[Math.min(i, responses.length - 1)];
    i += 1;
    if (!entry) throw new Error("scriptedFetch: empty script");
    return typeof entry === "function" ? entry() : entry;
  }) as typeof fetch;
  return { fetchFn, calls };
}

describe("createStaticFetcher", () => {
  it("uses redirect: manual and follows a same-host redirect to a safe target", async () => {
    const { fetchFn, calls } = scriptedFetch([
      redirectResponse("https://example.com/moved"),
      htmlResponse("<html><body>hello</body></html>"),
    ]);
    const fetcher = createStaticFetcher({ fetch: fetchFn });

    const text = await fetcher.fetch("https://example.com/start", new AbortController().signal);

    expect(text).toContain("hello");
    expect(calls).toHaveLength(2);
    expect(calls[0]?.init?.redirect).toBe("manual");
    expect(calls[1]?.url).toBe("https://example.com/moved");
  });

  it("refuses a redirect to a private host (spec: Loopback or private host)", async () => {
    const { fetchFn, calls } = scriptedFetch([redirectResponse("http://127.0.0.1/internal")]);
    const fetcher = createStaticFetcher({ fetch: fetchFn });

    await expect(
      fetcher.fetch("https://example.com/start", new AbortController().signal),
    ).rejects.toBeInstanceOf(UnsafeUrlError);
    expect(calls).toHaveLength(1);
  });

  it("refuses the initial URL before ever calling fetch", async () => {
    const { fetchFn, calls } = scriptedFetch([htmlResponse("<html><body>x</body></html>")]);
    const fetcher = createStaticFetcher({ fetch: fetchFn });

    await expect(
      fetcher.fetch("http://169.254.169.254/latest/meta-data", new AbortController().signal),
    ).rejects.toBeInstanceOf(UnsafeUrlError);
    expect(calls).toHaveLength(0);
  });

  it("caps redirect hops at the configured limit (spec: redirect: manual with 3-hop cap)", async () => {
    const { fetchFn, calls } = scriptedFetch([
      redirectResponse("https://example.com/hop1"),
      redirectResponse("https://example.com/hop2"),
      redirectResponse("https://example.com/hop3"),
      redirectResponse("https://example.com/hop4"),
    ]);
    const fetcher = createStaticFetcher({ fetch: fetchFn, maxHops: 3 });

    const err = await fetcher
      .fetch("https://example.com/start", new AbortController().signal)
      .catch((e) => e);

    expect(err).toBeInstanceOf(PageFetchFailedError);
    expect((err as PageFetchFailedError).kind).toBe("redirects");
    // 1 initial + 3 followed hops = 4 fetch calls before the 4th redirect is refused
    expect(calls).toHaveLength(4);
  });

  it("rejects a non-2xx status (spec: non-200 rejected)", async () => {
    const { fetchFn } = scriptedFetch([
      new Response("not found", { status: 404, headers: { "content-type": "text/html" } }),
    ]);
    const fetcher = createStaticFetcher({ fetch: fetchFn });

    const err = await fetcher
      .fetch("https://example.com/missing", new AbortController().signal)
      .catch((e) => e);

    expect(err).toBeInstanceOf(PageFetchFailedError);
    expect((err as PageFetchFailedError).kind).toBe("http-status");
  });

  it("rejects a disallowed content-type (spec: non-html rejected)", async () => {
    const { fetchFn } = scriptedFetch([
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    ]);
    const fetcher = createStaticFetcher({ fetch: fetchFn });

    const err = await fetcher
      .fetch("https://example.com/api", new AbortController().signal)
      .catch((e) => e);

    expect(err).toBeInstanceOf(PageFetchFailedError);
    expect((err as PageFetchFailedError).kind).toBe("content-type");
  });

  it("aborts and reports too-large once the streamed byte cap is exceeded (spec: Response exceeds the size cap)", async () => {
    const chunk = new Uint8Array(64).fill(97);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(chunk);
      },
    });
    const oversized = new Response(stream, { status: 200, headers: { "content-type": "text/html" } });
    const { fetchFn } = scriptedFetch([oversized]);
    const fetcher = createStaticFetcher({ fetch: fetchFn, maxBytes: 100 });

    const err = await fetcher
      .fetch("https://example.com/big", new AbortController().signal)
      .catch((e) => e);

    expect(err).toBeInstanceOf(PageFetchFailedError);
    expect((err as PageFetchFailedError).kind).toBe("too-large");
  });

  it("reports a timeout when the caller's AbortSignal fires (spec: Fetch exceeds the time cap)", async () => {
    const controller = new AbortController();
    const fetchFn = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted", "AbortError"));
        });
      });
    }) as typeof fetch;
    const fetcher = createStaticFetcher({ fetch: fetchFn });

    const pending = fetcher.fetch("https://example.com/slow", controller.signal);
    controller.abort();
    const err = await pending.catch((e) => e);

    expect(err).toBeInstanceOf(PageFetchFailedError);
    expect((err as PageFetchFailedError).kind).toBe("timeout");
  });

  it("resolves a relative Location header against the current URL before re-guarding", async () => {
    const { fetchFn, calls } = scriptedFetch([
      redirectResponse("/moved-here"),
      htmlResponse("<html><body>relative ok</body></html>"),
    ]);
    const fetcher = createStaticFetcher({ fetch: fetchFn });

    const text = await fetcher.fetch("https://example.com/start", new AbortController().signal);

    expect(text).toContain("relative ok");
    expect(calls[1]?.url).toBe("https://example.com/moved-here");
  });
});
